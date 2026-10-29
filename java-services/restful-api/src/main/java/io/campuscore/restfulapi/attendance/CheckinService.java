package io.campuscore.restfulapi.attendance;

import static io.campuscore.restfulapi.attendance.AttendanceDtos.*;
import static io.campuscore.restfulapi.attendance.SessionService.failure;
import io.campuscore.restfulapi.academic.repository.AcademicAttendanceWriteRepository;
import io.campuscore.restfulapi.academic.service.AcademicAttendanceWriteService;
import io.campuscore.restfulapi.audit.AdminAuditRecorder;
import io.campuscore.restfulapi.security.ratelimit.RateLimiterService;
import io.campuscore.restfulapi.web.DomainException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Profile("persistence")
public class CheckinService {
    private final AttendanceStore store;
    private final SessionService sessions;
    private final AcademicAttendanceWriteRepository academic;
    private final AcademicAttendanceWriteService attendance;
    private final CodeService codes;
    private final GeofenceVerifier verifier;
    private final RiskEvaluator risk;
    private final RateLimiterService limiter;
    private final AttendanceCheckinProperties properties;
    private final AdminAuditRecorder audit;
    private final Clock clock;
    public CheckinService(AttendanceStore store,SessionService sessions,AcademicAttendanceWriteRepository academic,
            AcademicAttendanceWriteService attendance,CodeService codes,GeofenceVerifier verifier,RiskEvaluator risk,
            RateLimiterService limiter,AttendanceCheckinProperties properties,AdminAuditRecorder audit,
            @Qualifier("attendanceClock") Clock clock) {
        this.store=store;this.sessions=sessions;this.academic=academic;this.attendance=attendance;this.codes=codes;
        this.verifier=verifier;this.risk=risk;this.limiter=limiter;this.properties=properties;this.audit=audit;this.clock=clock;
    }
    public static class Throttled extends DomainException {
        private final long retryAfter;
        public Throttled(long retryAfter) {
            super(HttpStatus.TOO_MANY_REQUESTS,"TOO_MANY_ATTEMPTS","Too many check-in attempts"); this.retryAfter=retryAfter;
        }
        public long retryAfter() { return retryAfter; }
    }
    /** Domain rejection commits its audit attempt; unexpected storage failures roll back atomically. */
    @Transactional(noRollbackFor=DomainException.class)
    public CheckinResponse checkin(String sessionId,String student,CheckinRequest r,String ip) {
        Instant now=clock.instant();
        String ipHash=risk.hash("ip",ip);
        String requestHash=null;
        boolean exists=false;
        try {
            var s=store.session(sessionId,false);
            if(s==null) throw failure(HttpStatus.GONE,"SESSION_CLOSED");
            exists=true;
            // Global lock order, shared with registration: Student -> Section -> Session -> Geofence.
            store.lockStudent(student);
            store.lockSection(s.sectionId());
            s=store.session(sessionId,true);
            // Lock contention must not extend the attendance window using a pre-wait timestamp.
            now=clock.instant();
            enforceLimits(sessionId,student,ipHash,now);
            if(!academic.findActiveEnrolledStudentIds(s.sectionId()).contains(student)) throw failure(HttpStatus.FORBIDDEN,"NOT_ENROLLED");
            if(!store.consent(student,properties.getConsentVersion()).accepted()) throw failure(HttpStatus.FORBIDDEN,"CONSENT_REQUIRED");
            List<AttendanceStore.Checkin> peers=store.checkins(sessionId);
            if(peers.stream().anyMatch(c->c.studentId().equals(student) && !c.decision().equals("REJECTED")))
                throw failure(HttpStatus.CONFLICT,"ALREADY_CHECKED_IN");
            requireOpen(s,now);
            var g=store.geofence(s.geofenceId(),true);
            if(!g.isActive()) throw failure(HttpStatus.GONE,"SESSION_CLOSED");
            // The geofence FOR UPDATE is the last blocking lock: re-admit against
            // a fresh timestamp so a queued request cannot write after the window
            // ended; code step and fix freshness re-check below use this clock too.
            now=clock.instant();
            requireOpen(s,now);
            if(r==null || r.latitude()==null || r.longitude()==null || r.accuracyMeters()==null || r.capturedAt()==null
                    || r.mockProvider()==null || r.installationId()==null || r.installationId().isBlank()
                    || r.installationId().length()>200 || (r.nonce()!=null && (r.nonce().length()<16 || r.nonce().length()>200)))
                throw failure(HttpStatus.BAD_REQUEST,"INVALID_LOCATION");
            String device=risk.hash("device",r.installationId());
            // A supplied random nonce is preferred. Legacy section-5 bodies have a deterministic single-use fix fingerprint.
            requestHash=risk.hash("request",sessionId+"\0"+student+"\0"+(r.nonce()!=null?r.nonce():
                    r.installationId()+"\0"+r.capturedAt()+"\0"+r.latitude()+"\0"+r.longitude()));
            if(store.replayed(sessionId,student,requestHash)) throw failure(HttpStatus.BAD_REQUEST,"INVALID_LOCATION");
            if(s.requireCode() && !codes.accepts(sessionId,s.codeSecret(),r.code())) throw failure(HttpStatus.UNPROCESSABLE_ENTITY,"BAD_CODE");
            var geo=verifier.verify(r.latitude(),r.longitude(),r.accuracyMeters(),r.capturedAt(),g.centerLat(),g.centerLng(),g.radiusMeters());
            if(geo.decision().equals("REJECTED")) throw failure(geo.reason().equals("INVALID_LOCATION")?HttpStatus.BAD_REQUEST:HttpStatus.UNPROCESSABLE_ENTITY,geo.reason());
            List<AttendanceStore.Checkin> active=peers.stream().filter(c->!c.decision().equals("REJECTED") && !c.studentId().equals(student)).toList();
            List<AttendanceStore.Checkin> shared=active.stream().filter(c->c.deviceHash().equals(device)).toList();
            List<AttendanceStore.Checkin> cluster=active.stream().filter(c->c.lat()!=null && c.lng()!=null
                    && rounded(c.lat())==rounded(r.latitude()) && rounded(c.lng())==rounded(r.longitude())).toList();
            // Same-day non-rejected prior fix (pending positions are real submissions).
            Instant dayStart=s.date().atStartOfDay(SessionService.CAMPUS_ZONE).toInstant();
            var reasons=risk.evaluate(r.mockProvider(),r.accuracyMeters(),new RiskEvaluator.Position(r.latitude(),r.longitude(),r.capturedAt()),
                    store.previousRelevant(student,dayStart,dayStart.plus(Duration.ofDays(1))),!shared.isEmpty(),(int)cluster.stream().map(AttendanceStore.Checkin::studentId).distinct().count());
            String decision=reasons.isEmpty()?geo.decision():"PENDING_REVIEW";
            String reason=reasons.isEmpty()?geo.reason():String.join(",",reasons)+(geo.reason().equals("BORDERLINE")?",BORDERLINE":"");
            for(var c:shared) store.flag(c,"SHARED_DEVICE");
            if(cluster.stream().map(AttendanceStore.Checkin::studentId).distinct().count()>=3)
                for(var c:cluster) store.flag(c,c.reason().contains("SHARED_DEVICE")?"SHARED_DEVICE,IDENTICAL_COORDINATES":"IDENTICAL_COORDINATES");
            var c=new AttendanceStore.Checkin(UUID.randomUUID().toString(),sessionId,student,device,decision,reason,
                    geo.distanceMeters(),r.accuracyMeters(),r.latitude(),r.longitude(),r.mockProvider(),r.capturedAt(),now,null,null,null);
            store.insertCheckin(c);
            String status=decision.equals("ACCEPTED")?writeAttendance(s,c):"PENDING_REVIEW";
            store.attempt(sessionId,student,decision,reason,ipHash,requestHash,now,true);
            return new CheckinResponse(decision,status,reason);
        } catch(DomainException denied) {
            store.attempt(sessionId,student,denied.code(),ipHash,requestHash,now,exists);
            throw denied;
        }
    }
    private static long rounded(double value) { return Math.round(value*100_000); }
    private void requireOpen(AttendanceStore.Session s,Instant now) {
        if(!s.openAt(now)) {
            if(!now.isBefore(s.closesAt())) store.close(s.id(),s.closesAt());
            throw failure(HttpStatus.GONE,"SESSION_CLOSED");
        }
    }
    @Transactional(noRollbackFor=DomainException.class)
    public void recordInvalidAttempt(String session,String student,String ip,String code) {
        String hash=risk.hash("ip",ip);
        var s=store.session(session,false);
        if(s!=null) { store.lockStudent(student); store.lockSection(s.sectionId()); store.session(session,true); }
        try {
            if(s!=null) enforceLimits(session,student,hash,clock.instant());
        } catch(Throttled denied) {
            store.attempt(session,student,denied.code(),hash,null,clock.instant(),s!=null); throw denied;
        }
        store.attempt(session,student,code,hash,null,clock.instant(),s!=null);
    }
    private void enforceLimits(String session,String student,String ip,Instant now) {
        var perStudent=limiter.tryAcquire("attendance:student:"+session+":"+student,5,600);
        var perIp=limiter.tryAcquire("attendance:ip:"+session+":"+ip,30,60);
        // Durable counts prevent restart, multi-instance and the shared limiter's 5-minute cleanup from bypassing limits.
        if(!perStudent.allowed() || store.studentAttempts(session,student,now.minusSeconds(600))>=5) throw new Throttled(600);
        if(!perIp.allowed() || store.ipAttempts(session,ip,now.minusSeconds(60))>=30) throw new Throttled(60);
    }
    private String writeAttendance(AttendanceStore.Session s,AttendanceStore.Checkin c) {
        String status=c.createdAt().isBefore(s.opensAt().plusSeconds(s.lateAfterMinutes()*60L))?"PRESENT":"LATE";
        return attendance.recordStudentCheckin(s.sectionId(),c.studentId(),s.date().toString(),status,c.id(),clock.instant());
    }
    @Transactional
    public CheckinView review(String id,ReviewRequest r,String actor,String lecturer,List<String> roles) {
        var c=store.findCheckin(id); var s=sessions.require(c.sessionId());
        sessions.authorize(s.sectionId(),lecturer,roles);
        store.lockStudent(c.studentId()); store.lockSection(s.sectionId());
        // Re-verify ownership under the section lock: it may have been reassigned while waiting.
        sessions.authorize(s.sectionId(),lecturer,roles);
        store.session(s.id(),true);
        c=store.findCheckin(id);
        if(!c.decision().equals("PENDING_REVIEW")) throw failure(HttpStatus.CONFLICT,"CHECKIN_ALREADY_REVIEWED");
        String decision=r.decision().equals("APPROVE")?"ACCEPTED":"REJECTED";
        if(decision.equals("ACCEPTED")) {
            if(!academic.findActiveEnrolledStudentIds(s.sectionId()).contains(c.studentId())) throw failure(HttpStatus.FORBIDDEN,"NOT_ENROLLED");
            writeAttendance(s,c);
        }
        store.review(id,decision,actor,r.note(),clock.instant());
        audit.record(actor,null,"REVIEWED","AttendanceCheckin",id,"Check-in "+decision,c.view(),store.findCheckin(id).view());
        return store.findCheckin(id).view();
    }
    @Transactional(readOnly=true)
    public ConsentResponse consent(String student) { return store.consent(student,properties.getConsentVersion()); }
    @Transactional
    public ConsentResponse acceptConsent(String student,String version) {
        if(!properties.getConsentVersion().equals(version)) throw failure(HttpStatus.BAD_REQUEST,"INVALID_CONSENT_VERSION");
        store.lockStudent(student); store.saveConsent(student,version,clock.instant()); return consent(student);
    }
}
