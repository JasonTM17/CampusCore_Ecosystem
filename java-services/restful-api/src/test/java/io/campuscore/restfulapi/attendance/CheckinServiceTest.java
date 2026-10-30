package io.campuscore.restfulapi.attendance;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static io.campuscore.restfulapi.attendance.AttendanceDtos.*;
import io.campuscore.restfulapi.academic.repository.AcademicAttendanceWriteRepository;
import io.campuscore.restfulapi.academic.service.AcademicAttendanceWriteService;
import io.campuscore.restfulapi.audit.AdminAuditRecorder;
import io.campuscore.restfulapi.security.ratelimit.RateLimiterService;
import io.campuscore.restfulapi.web.DomainException;
import java.time.*;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class CheckinServiceTest {
    private final Instant now=Instant.parse("2026-10-29T03:00:00Z");
    private final Clock clock=Clock.fixed(now,ZoneOffset.UTC);
    private final AttendanceStore store=mock(AttendanceStore.class);
    private final SessionService sessions=mock(SessionService.class);
    private final AcademicAttendanceWriteRepository academic=mock(AcademicAttendanceWriteRepository.class);
    private final AcademicAttendanceWriteService attendance=mock(AcademicAttendanceWriteService.class);
    private final CodeService codes=mock(CodeService.class);
    private final AttendanceCheckinProperties properties=CodeServiceTest.properties();
    private final CheckinService service=new CheckinService(store,sessions,academic,attendance,codes,new GeofenceVerifier(clock),
            new RiskEvaluator(properties),new RateLimiterService(clock),properties,mock(AdminAuditRecorder.class),clock);
    private AttendanceStore.Session session;
    @BeforeEach void fixture() {
        session=new AttendanceStore.Session("session","section",LocalDate.parse("2026-10-29"),"fence",now.minusSeconds(30),now.plusSeconds(600),10,true,"OPEN","encrypted");
        when(store.session(eq("session"),anyBoolean())).thenReturn(session);
        when(academic.findActiveEnrolledStudentIds("section")).thenReturn(java.util.Set.of("student"));
        when(store.consent("student","1")).thenReturn(new ConsentResponse(true,"1","1",now));
        when(store.geofence("fence",true)).thenReturn(new GeofenceResponse("fence","campus","UTE",10,106,150,true,null));
        when(codes.accepts(anyString(),anyString(),any())).thenReturn(true);
        when(attendance.recordStudentCheckin(anyString(),anyString(),anyString(),anyString(),anyString(),any())).thenReturn("PRESENT");
    }
    private CheckinRequest request(double lat,double accuracy) {
        return new CheckinRequest("123456",lat,106.0,accuracy,now,false,"installation",null);
    }
    private void error(String code,Runnable call) {
        assertThatThrownBy(call::run).isInstanceOfSatisfying(DomainException.class,e->assertThat(e.code()).isEqualTo(code));
        verify(store).attempt(eq("session"),eq("student"),eq(code),anyString(),nullable(String.class),eq(now),anyBoolean());
    }
    @Test void unenrolledStudentRefusedAndAttemptAudited() {
        when(academic.findActiveEnrolledStudentIds("section")).thenReturn(java.util.Set.of());
        error("NOT_ENROLLED",()->service.checkin("session","student",request(10,5),"ip"));
    }
    @Test void missingConsentRefusedAndAttemptAudited() {
        when(store.consent("student","1")).thenReturn(new ConsentResponse(false,"1",null,null));
        error("CONSENT_REQUIRED",()->service.checkin("session","student",request(10,5),"ip"));
    }
    @Test void nonexistentSessionRefusedWithoutForeignKeyReference() {
        when(store.session("session",false)).thenReturn(null);
        error("SESSION_CLOSED",()->service.checkin("session","student",request(10,5),"ip"));
        verify(store).attempt(eq("session"),eq("student"),eq("SESSION_CLOSED"),anyString(),isNull(),eq(now),eq(false));
    }
    @Test void closedWindowRefusedAndLazilyClosed() {
        var closed=new AttendanceStore.Session("session","section",session.date(),"fence",now.minusSeconds(900),now,10,true,"OPEN","encrypted");
        when(store.session(eq("session"),anyBoolean())).thenReturn(closed);
        error("SESSION_CLOSED",()->service.checkin("session","student",request(10,5),"ip"));verify(store).close("session",now);
    }
    @Test void waitingForDatabaseLockCannotExtendExpiredSessionWindow() {
        Instant[] time={now};
        Clock advancing=new Clock() {
            public ZoneId getZone() { return ZoneOffset.UTC; }
            public Clock withZone(ZoneId zone) { return this; }
            public Instant instant() { return time[0]; }
        };
        var shortWindow=new AttendanceStore.Session("session","section",session.date(),"fence",now.minusSeconds(30),now.plusSeconds(10),0,true,"OPEN","encrypted");
        when(store.session(eq("session"),anyBoolean())).thenReturn(shortWindow);
        doAnswer(call->{time[0]=now.plusSeconds(11);return null;}).when(store).lockSection("section");
        var queued=new CheckinService(store,sessions,academic,attendance,codes,new GeofenceVerifier(advancing),new RiskEvaluator(properties),
                new RateLimiterService(advancing),properties,mock(AdminAuditRecorder.class),advancing);
        assertThatThrownBy(()->queued.checkin("session","student",request(10,5),"ip"))
                .isInstanceOfSatisfying(DomainException.class,e->assertThat(e.code()).isEqualTo("SESSION_CLOSED"));
        verifyNoInteractions(attendance);
        verify(store).close("session",now.plusSeconds(10));
    }
    @Test void geofenceLockWaitCannotExtendExpiredSessionWindow() {
        Instant[] time={now};
        Clock advancing=new Clock() {
            public ZoneId getZone() { return ZoneOffset.UTC; }
            public Clock withZone(ZoneId zone) { return this; }
            public Instant instant() { return time[0]; }
        };
        var shortWindow=new AttendanceStore.Session("session","section",session.date(),"fence",now.minusSeconds(30),now.plusSeconds(10),0,true,"OPEN","encrypted");
        when(store.session(eq("session"),anyBoolean())).thenReturn(shortWindow);
        // The geofence FOR UPDATE is the last blocking lock: the window must be
        // re-validated against a fresh timestamp once it is acquired.
        doAnswer(call->{time[0]=now.plusSeconds(11);return new GeofenceResponse("fence","campus","UTE",10,106,150,true,null);})
                .when(store).geofence("fence",true);
        var queued=new CheckinService(store,sessions,academic,attendance,codes,new GeofenceVerifier(advancing),new RiskEvaluator(properties),
                new RateLimiterService(advancing),properties,mock(AdminAuditRecorder.class),advancing);
        assertThatThrownBy(()->queued.checkin("session","student",request(10,5),"ip"))
                .isInstanceOfSatisfying(DomainException.class,e->assertThat(e.code()).isEqualTo("SESSION_CLOSED"));
        verifyNoInteractions(attendance);
        verify(store).close("session",now.plusSeconds(10));
    }
    @Test void inactiveFenceRefused() {
        when(store.geofence("fence",true)).thenReturn(new GeofenceResponse("fence","campus","UTE",10,106,150,false,null));
        error("SESSION_CLOSED",()->service.checkin("session","student",request(10,5),"ip"));
    }
    @Test void badCodeRefusedBeforeLocationOrAttendanceWrites() {
        when(codes.accepts(anyString(),anyString(),any())).thenReturn(false);
        error("BAD_CODE",()->service.checkin("session","student",request(10,5),"ip"));verifyNoInteractions(attendance);
    }
    @Test void malformedLocationRefused() { error("INVALID_LOCATION",()->service.checkin("session","student",request(Double.NaN,5),"ip")); }
    @Test void outsideAreaRefused() { error("OUTSIDE_AREA",()->service.checkin("session","student",request(11,5),"ip")); }
    @Test void inaccurateLocationRefused() { error("LOW_ACCURACY",()->service.checkin("session","student",request(10,101),"ip")); }
    @Test void replayedFailedRequestCannotBecomeSuccessful() {
        when(store.replayed(anyString(),anyString(),anyString())).thenReturn(true);
        error("INVALID_LOCATION",()->service.checkin("session","student",request(10,5),"ip"));verifyNoInteractions(attendance);
    }
    @Test void acceptedWritesPresentAndUsesOnlyAuthenticatedStudent() {
        assertThat(service.checkin("session","student",request(10,5),"ip").decision()).isEqualTo("ACCEPTED");
        verify(attendance).recordStudentCheckin(eq("section"),eq("student"),eq("2026-10-29"),eq("PRESENT"),anyString(),eq(now));
    }
    @Test void thresholdIsLateAndReviewDoesNotUseReviewTime() {
        var late=new AttendanceStore.Session("session","section",session.date(),"fence",now.minusSeconds(600),now.plusSeconds(300),10,true,"OPEN","encrypted");
        when(store.session(eq("session"),anyBoolean())).thenReturn(late);
        service.checkin("session","student",request(10,5),"ip");
        verify(attendance).recordStudentCheckin(eq("section"),eq("student"),anyString(),eq("LATE"),anyString(),eq(now));
    }
    @Test void borderlineAndRiskWriteNothingToAttendance() {
        assertThat(service.checkin("session","student",request(10,75),"ip").decision()).isEqualTo("PENDING_REVIEW");
        verifyNoInteractions(attendance);
    }
    @Test void idempotentDuplicateReturnsConflictWithoutSecondWrite() {
        var prior=new AttendanceStore.Checkin("c","session","student","device","ACCEPTED","INSIDE",0,5,10.0,106.0,false,now,now,null,null,null);
        when(store.checkins("session")).thenReturn(List.of(prior));
        error("ALREADY_CHECKED_IN",()->service.checkin("session","student",request(10,5),"ip"));verifyNoInteractions(attendance);
    }
    @Test void sixthCodeGuessIsThrottledAndEveryFailureIsAudited() {
        when(codes.accepts(anyString(),anyString(),any())).thenReturn(false);
        for(int i=0;i<5;i++) assertThatThrownBy(()->service.checkin("session","student",request(10,5),"ip")).isInstanceOf(DomainException.class);
        assertThatThrownBy(()->service.checkin("session","student",request(10,5),"ip")).isInstanceOf(CheckinService.Throttled.class);
        verify(codes,times(5)).accepts(anyString(),anyString(),any());
        verify(store,times(6)).attempt(anyString(),anyString(),anyString(),anyString(),nullable(String.class),any(),eq(true));
    }
    @Test void persistedCountsDefeatLimiterReset() {
        when(store.studentAttempts(eq("session"),eq("student"),any())).thenReturn(5L);
        error("TOO_MANY_ATTEMPTS",()->service.checkin("session","student",request(10,5),"another-ip"));
    }
    @Test void perSessionIpBucketRejectsThirtyFirstAttempt() {
        when(store.ipAttempts(eq("session"),anyString(),any())).thenReturn(30L);
        error("TOO_MANY_ATTEMPTS",()->service.checkin("session","student",request(10,5),"ip"));
    }
    @Test void sharedDeviceFlagsPriorCheckinAndHoldsCurrentOne() {
        String device=new RiskEvaluator(properties).hash("device","installation");
        var prior=new AttendanceStore.Checkin("c","session","other",device,"ACCEPTED","INSIDE",0,5,10.0,106.0,false,now,now,null,null,null);
        when(store.checkins("session")).thenReturn(List.of(prior));
        assertThat(service.checkin("session","student",request(10,5),"ip").message()).contains("SHARED_DEVICE");
        verify(store).flag(prior,"SHARED_DEVICE");verifyNoInteractions(attendance);
    }
}
