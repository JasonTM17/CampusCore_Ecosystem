package io.campuscore.restfulapi.attendance;

import static io.campuscore.restfulapi.attendance.AttendanceDtos.*;
import io.campuscore.restfulapi.academic.repository.AcademicAttendanceWriteRepository;
import io.campuscore.restfulapi.audit.AdminAuditRecorder;
import io.campuscore.restfulapi.web.DomainException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Profile("persistence")
public class SessionService {
    public static final ZoneId CAMPUS_ZONE = ZoneId.of("Asia/Ho_Chi_Minh");
    private final AttendanceStore store;
    private final AcademicAttendanceWriteRepository academic;
    private final CodeService codes;
    private final Clock clock;
    private final AdminAuditRecorder audit;
    public SessionService(AttendanceStore store, AcademicAttendanceWriteRepository academic, CodeService codes,
                          @Qualifier("attendanceClock") Clock clock, AdminAuditRecorder audit) {
        this.store=store;this.academic=academic;this.codes=codes;this.clock=clock;this.audit=audit;
    }
    public void authorize(String section,String lecturer,List<String> roles) {
        if (!academic.sectionExists(section)) throw failure(HttpStatus.NOT_FOUND,"SECTION_NOT_FOUND");
        boolean admin=roles!=null && (roles.contains("ADMIN") || roles.contains("SUPER_ADMIN"));
        if (!admin && (lecturer==null || !academic.isSectionOwnedByLecturer(section,lecturer)))
            throw failure(HttpStatus.FORBIDDEN,"SECTION_FORBIDDEN");
    }
    public AttendanceStore.Session require(String id) {
        AttendanceStore.Session s=store.session(id,false);
        if (s==null) throw failure(HttpStatus.NOT_FOUND,"SESSION_NOT_FOUND");
        return s;
    }
    @Transactional
    public SessionResponse open(OpenSessionRequest r,String actor,String lecturer,List<String> roles) {
        authorize(r.sectionId(),lecturer,roles);
        Instant now=clock.instant(), opens=r.opensAt()==null?now:r.opensAt();
        Instant closes=r.closesAt()==null?opens.plusSeconds(900):r.closesAt();
        int late=r.lateAfterMinutes()==null?10:r.lateAfterMinutes();
        if (r.date()==null || !opens.atZone(CAMPUS_ZONE).toLocalDate().equals(r.date())
                || !closes.isAfter(opens) || Duration.between(opens,closes).compareTo(Duration.ofHours(1))>0
                || late<0 || late>60 || opens.plusSeconds(late*60L).isAfter(closes) || !closes.isAfter(now))
            throw failure(HttpStatus.BAD_REQUEST,"INVALID_SESSION_WINDOW");
        store.lockSection(r.sectionId());
        store.closeExpiredSection(r.sectionId(),now);
        if (!store.geofence(r.geofenceId(),true).isActive()) throw failure(HttpStatus.BAD_REQUEST,"GEOFENCE_INACTIVE");
        if (store.hasOpenSession(r.sectionId(),r.date())) throw failure(HttpStatus.CONFLICT,"SESSION_ALREADY_OPEN");
        String id=UUID.randomUUID().toString();
        var session=new AttendanceStore.Session(id,r.sectionId(),r.date(),r.geofenceId(),opens,closes,late,
                r.requireCode()==null || r.requireCode(),"OPEN",codes.newSecret(id));
        store.createSession(session,actor,now);
        audit.record(actor,null,"OPENED","AttendanceSession",id,"Attendance window opened");
        return store.summary(session,now,academic.findActiveEnrolledStudentIds(r.sectionId()).size());
    }
    @Transactional
    public SessionResponse get(String id,String lecturer,List<String> roles) {
        var s=require(id); authorize(s.sectionId(),lecturer,roles);
        if (!clock.instant().isBefore(s.closesAt())) store.close(id,s.closesAt());
        return store.summary(s,clock.instant(),academic.findActiveEnrolledStudentIds(s.sectionId()).size());
    }
    @Transactional
    public SessionResponse close(String id,String actor,String lecturer,List<String> roles) {
        var s=require(id); authorize(s.sectionId(),lecturer,roles);
        store.lockSection(s.sectionId()); s=store.session(id,true);
        store.close(id,clock.instant());
        audit.record(actor,null,"CLOSED","AttendanceSession",id,"Attendance window closed");
        return store.summary(store.session(id,false),clock.instant(),academic.findActiveEnrolledStudentIds(s.sectionId()).size());
    }
    @Transactional(readOnly=true)
    public CodeResponse code(String id,String lecturer,List<String> roles) {
        var s=require(id); authorize(s.sectionId(),lecturer,roles);
        if (!s.openAt(clock.instant())) throw failure(HttpStatus.GONE,"SESSION_CLOSED");
        Instant expiry=codes.expiresAt().isAfter(s.closesAt())?s.closesAt():codes.expiresAt();
        return new CodeResponse(codes.current(id,s.codeSecret()),expiry,CodeService.STEP_SECONDS);
    }
    @Transactional(readOnly=true)
    public List<CheckinView> checkins(String id,String lecturer,List<String> roles) {
        var s=require(id); authorize(s.sectionId(),lecturer,roles);
        return store.checkins(id).stream().map(AttendanceStore.Checkin::view).toList();
    }
    @Transactional(readOnly=true)
    public List<OpenSessionResponse> openForStudent(String student) {
        return store.openForStudent(student,LocalDate.now(clock.withZone(CAMPUS_ZONE)),clock.instant());
    }
    public static DomainException failure(HttpStatus status,String code) {
        return new DomainException(status,code,code.replace('_',' '));
    }
}
