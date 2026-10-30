package io.campuscore.restfulapi.attendance;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static io.campuscore.restfulapi.attendance.AttendanceDtos.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import io.campuscore.restfulapi.academic.service.AcademicAttendanceWriteService;
import io.campuscore.restfulapi.academic.web.AcademicAttendanceMutationDtos.*;
import io.campuscore.restfulapi.security.ratelimit.RateLimiterService;
import io.campuscore.restfulapi.testsupport.AccountAuthorityFixture;
import io.campuscore.restfulapi.web.DomainException;
import java.nio.file.*;
import java.time.*;
import java.util.List;
import java.util.concurrent.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

@SpringBootTest(properties={"spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:geofence;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000"})
@ActiveProfiles({"test","persistence"})
@AutoConfigureMockMvc
class AttendanceGeofencePersistenceTest {
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;
    @Autowired SessionService sessions;
    @Autowired CheckinService checkins;
    @Autowired AttendanceStore store;
    @Autowired CodeService codes;
    @Autowired AcademicAttendanceWriteService attendance;
    @Autowired AttendanceCheckinProperties properties;
    @Autowired RateLimiterService limiter;
    @MockitoBean(name="attendanceClock") Clock attendanceClock;
    private String id;
    @BeforeEach void fixture() {
        useClock(Clock.systemUTC());
        AttendanceTestSchema.create(jdbc,false);AttendanceTestSchema.clear(jdbc);
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS campuscore_auth");
        jdbc.execute("CREATE TABLE IF NOT EXISTS campuscore_auth.\"User\" (\"id\" VARCHAR(120) PRIMARY KEY,\"email\" VARCHAR(320),\"firstName\" VARCHAR(120),\"lastName\" VARCHAR(120),\"status\" VARCHAR(40) DEFAULT 'ACTIVE',\"mustChangePassword\" BOOLEAN DEFAULT FALSE)");
        AccountAuthorityFixture.prepare(jdbc);
        for(int i=1;i<=5;i++) { AccountAuthorityFixture.ensureUser(jdbc,"user"+i);AccountAuthorityFixture.role(jdbc,"user"+i,"STUDENT"); }
        AccountAuthorityFixture.ensureUser(jdbc,"lecturer-user");AccountAuthorityFixture.lecturer(jdbc,"lecturer-user","lecturer");
        AccountAuthorityFixture.ensureUser(jdbc,"other-user");AccountAuthorityFixture.lecturer(jdbc,"other-user","other-lecturer");
        AccountAuthorityFixture.ensureUser(jdbc,"admin-user");AccountAuthorityFixture.role(jdbc,"admin-user","ADMIN");
        properties.setEncryptionKey(CodeServiceTest.properties().getEncryptionKey());properties.setPepper(CodeServiceTest.properties().getPepper());limiter.clear();
        Instant now=Instant.now();
        id=sessions.open(new OpenSessionRequest("section",now.atZone(SessionService.CAMPUS_ZONE).toLocalDate(),now.minusSeconds(30),now.plusSeconds(900),10,"ute-main-placeholder",true),"lecturer-user","lecturer",List.of("LECTURER")).id();
        for(int i=1;i<=4;i++) checkins.acceptConsent("student"+i,"1");
    }
    private void useClock(Clock source) {
        when(attendanceClock.instant()).thenAnswer(invocation -> source.instant());
        when(attendanceClock.withZone(any(ZoneId.class))).thenAnswer(invocation -> source.withZone(invocation.getArgument(0)));
    }
    private CheckinRequest request(String device,double latitude) {
        var s=store.session(id,false);
        return new CheckinRequest(codes.current(id,s.codeSecret()),latitude,106.0,5.0,Instant.now(),false,device,null);
    }
    private static RequestPostProcessor student(int i) {
        return jwt().jwt(j->j.subject("user"+i).claim("studentId","student"+i).claim("student",java.util.Map.of("year",2026)).claim("roles",List.of("STUDENT")))
                .authorities(new SimpleGrantedAuthority("ROLE_STUDENT"));
    }
    private static RequestPostProcessor lecturer(boolean other) {
        return jwt().jwt(j->j.subject(other?"other-user":"lecturer-user").claim("lecturerId",other?"other-lecturer":"lecturer").claim("roles",List.of("LECTURER")))
                .authorities(new SimpleGrantedAuthority("ROLE_LECTURER"));
    }
    private static RequestPostProcessor admin() {
        return jwt().jwt(j->j.subject("admin-user").claim("roles",List.of("ADMIN"))).authorities(new SimpleGrantedAuthority("ROLE_ADMIN"));
    }
    private String body(String device) {
        return "{\"code\":\""+codes.current(id,store.session(id,false).codeSecret())+"\",\"latitude\":10,\"longitude\":106,\"accuracyMeters\":5,\"capturedAt\":\""+Instant.now()+"\",\"mockProvider\":false,\"installationId\":\""+device+"\"}";
    }
    @Test void anonymousIsUnauthorizedAndWrongRoleForbidden() throws Exception {
        mvc.perform(get("/api/v1/attendance/sessions/"+id)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/attendance/sessions/"+id).with(student(1))).andExpect(status().isForbidden());
        mvc.perform(post("/api/v1/attendance/sessions/"+id+"/checkin").with(lecturer(false)).contentType(MediaType.APPLICATION_JSON).content(body("d"))).andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/admin/attendance/geofences").with(lecturer(false))).andExpect(status().isForbidden());
    }
    @Test void activeGeofenceOptionsAreLecturerSafeAndOnlyListEnabledFences() throws Exception {
        String route="/api/v1/attendance/geofences/active";
        jdbc.update("UPDATE academic.\"AttendanceGeofence\" SET \"isActive\"=FALSE WHERE \"id\"='ute-main-placeholder'");
        jdbc.update("""
                INSERT INTO academic."AttendanceGeofence" ("id","name","campusCode","centerLat","centerLng","radiusMeters","isActive","note","createdBy")
                VALUES ('active-verified','Verified campus','UTE-VERIFIED',10.25,106.5,120,TRUE,'admin-only note','admin-user')
                """);
        jdbc.update("""
                INSERT INTO academic."AttendanceGeofence" ("id","name","campusCode","centerLat","centerLng","radiusMeters","isActive","note","createdBy")
                VALUES ('inactive-campus','Inactive campus','UTE-OLD',10.5,106.75,150,FALSE,'inactive note','admin-user')
                """);

        mvc.perform(get(route)).andExpect(status().isUnauthorized());
        mvc.perform(get(route).with(student(1))).andExpect(status().isForbidden());
        for (var role : List.of(lecturer(false),admin())) {
            mvc.perform(get(route).with(role)).andExpect(status().isOk())
                    .andExpect(jsonPath("$[0].id").value("active-verified"))
                    .andExpect(jsonPath("$[1]").doesNotExist())
                    .andExpect(jsonPath("$[0].name").value("Verified campus"))
                    .andExpect(jsonPath("$[0].campusCode").value("UTE-VERIFIED"))
                    .andExpect(jsonPath("$[0].centerLat").value(10.25))
                    .andExpect(jsonPath("$[0].centerLng").value(106.5))
                    .andExpect(jsonPath("$[0].radiusMeters").value(120))
                    .andExpect(jsonPath("$[0].isActive").doesNotExist())
                    .andExpect(jsonPath("$[0].note").doesNotExist())
                    .andExpect(jsonPath("$[0].createdBy").doesNotExist())
                    .andExpect(jsonPath("$[0].createdAt").doesNotExist())
                    .andExpect(jsonPath("$[0].updatedAt").doesNotExist())
                    .andExpect(header().doesNotExist("ETag"));
        }
    }
    @Test void allAttendanceRoutesRequireAuthenticationAndStudentCannotManageSessionsOrGeofences() throws Exception {
        String base="/api/v1/attendance",geo="/api/v1/admin/attendance/geofences";
        var anonymous=List.of(post(base+"/sessions"),get(base+"/sessions/"+id),get(base+"/sessions/"+id+"/code"),
                post(base+"/sessions/"+id+"/close"),get(base+"/sessions/"+id+"/checkins"),post(base+"/checkins/missing/review"),
                get(base+"/sessions/open"),post(base+"/sessions/"+id+"/checkin"),post(base+"/location-consent"),
                get(base+"/location-consent"),get(base+"/geofences/active"),get(geo),post(geo),put(geo+"/ute-main-placeholder"));
        for(var request:anonymous) mvc.perform(request.contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isUnauthorized());
        for(var request:List.of(get(base+"/sessions/"+id+"/code"),post(base+"/sessions/"+id+"/close"),get(base+"/sessions/"+id+"/checkins"),get(base+"/geofences/active"),get(geo)))
            mvc.perform(request.with(student(1))).andExpect(status().isForbidden());
        mvc.perform(post(base+"/checkins/missing/review").with(student(1)).contentType(MediaType.APPLICATION_JSON).content("{\"decision\":\"APPROVE\",\"note\":\"test\"}"))
                .andExpect(status().isForbidden());
        for(var request:List.of(get(base+"/location-consent"),post(base+"/location-consent").contentType(MediaType.APPLICATION_JSON).content("{\"version\":\"1\"}"),get(base+"/sessions/open")))
            mvc.perform(request.with(lecturer(false))).andExpect(status().isForbidden());
    }
    @Test void consentRoutesAreVersionedAndAdminCanCreateAndDeactivateReferencedGeofence() throws Exception {
        mvc.perform(get("/api/v1/attendance/location-consent").with(student(5))).andExpect(status().isOk()).andExpect(jsonPath("$.accepted").value(false));
        mvc.perform(post("/api/v1/attendance/location-consent").with(student(5)).contentType(MediaType.APPLICATION_JSON).content("{\"version\":\"1\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.accepted").value(true));
        mvc.perform(post("/api/v1/attendance/location-consent").with(student(5)).contentType(MediaType.APPLICATION_JSON).content("{\"version\":\"obsolete\"}"))
                .andExpect(status().isBadRequest());
        String payload="{\"name\":\"verified campus\",\"campusCode\":\"UTE\",\"centerLat\":10,\"centerLng\":106,\"radiusMeters\":150,\"isActive\":false}";
        mvc.perform(post("/api/v1/admin/attendance/geofences").with(admin()).contentType(MediaType.APPLICATION_JSON).content(payload)).andExpect(status().isCreated());
        mvc.perform(put("/api/v1/admin/attendance/geofences/ute-main-placeholder").with(admin()).contentType(MediaType.APPLICATION_JSON).content(payload)).andExpect(status().isOk());
        assertThat(store.geofence("ute-main-placeholder",false).isActive()).isFalse();
        assertThat(store.session(id,false)).isNotNull();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM campuscore_audit.\"AdminAudit\" WHERE \"entityType\"='AttendanceGeofence'",Integer.class)).isGreaterThanOrEqualTo(2);
    }
    @Test void otherLecturerCannotReadCodeCountsOrReviewAndAdminCanRead() throws Exception {
        for(String suffix:new String[]{"","/code","/checkins"})
            mvc.perform(get("/api/v1/attendance/sessions/"+id+suffix).with(lecturer(true))).andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/attendance/sessions/"+id).with(admin())).andExpect(status().isOk()).andExpect(jsonPath("$.enrolled").value(4)).andExpect(jsonPath("$.codeSecret").doesNotExist());
        mvc.perform(get("/api/v1/attendance/sessions/"+id+"/code").with(lecturer(false)))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control",org.hamcrest.Matchers.containsString("no-store")));
    }
    @Test void studentNotEnrolledReceivesForbiddenAndNoCoordinatesAreDisclosed() throws Exception {
        mvc.perform(post("/api/v1/attendance/sessions/"+id+"/checkin").with(student(5)).contentType(MediaType.APPLICATION_JSON).content(body("d")))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("NOT_ENROLLED"));
        mvc.perform(get("/api/v1/attendance/sessions/open").with(student(1))).andExpect(status().isOk())
                .andExpect(jsonPath("$[0].geofenceName").exists()).andExpect(jsonPath("$[0].centerLat").doesNotExist()).andExpect(jsonPath("$[0].radiusMeters").doesNotExist());
    }
    @Test void crossMidnightSessionRemainsDiscoverableUntilCloseAndKeepsSessionDate() {
        LocalDate sessionDate=LocalDate.of(2026,10,30);
        ZoneId zone=SessionService.CAMPUS_ZONE;
        Instant opensAt=sessionDate.atTime(23,50).atZone(zone).toInstant();
        Instant beforeMidnight=sessionDate.atTime(23,55).atZone(zone).toInstant();
        Instant afterMidnight=sessionDate.plusDays(1).atTime(0,5).atZone(zone).toInstant();
        Instant closesAt=sessionDate.plusDays(1).atTime(0,20).atZone(zone).toInstant();
        String sessionId="cross-midnight-session";
        jdbc.update("INSERT INTO academic.\"Section\" (\"id\",\"lecturerId\",\"sectionNumber\") VALUES ('section-cross','lecturer','C')");
        jdbc.update("INSERT INTO academic.\"Enrollment\" (\"id\",\"sectionId\",\"studentId\",\"status\") VALUES ('enroll-cross','section-cross','student1','ENROLLED')");
        store.createSession(new AttendanceStore.Session(sessionId,"section-cross",sessionDate,"ute-main-placeholder",
                opensAt,closesAt,10,false,"OPEN",codes.newSecret(sessionId)),"lecturer-user",opensAt);

        useClock(Clock.fixed(beforeMidnight,zone));
        assertThat(sessions.openForStudent("student1")).extracting(OpenSessionResponse::id).contains(sessionId);
        useClock(Clock.fixed(afterMidnight,zone));
        assertThat(sessions.openForStudent("student1")).extracting(OpenSessionResponse::id).contains(sessionId);
        assertThat(sessions.openForStudent("student5")).extracting(OpenSessionResponse::id).doesNotContain(sessionId);

        var response=checkins.checkin(sessionId,"student1",new CheckinRequest(null,10.0,106.0,5.0,afterMidnight,false,"cross-midnight-device",null),"ip");
        assertThat(response.decision()).isEqualTo("ACCEPTED");
        Instant recordedDate=jdbc.queryForObject("SELECT \"date\" FROM academic.\"Attendance\" WHERE \"studentId\"='student1'",
                (rs,row)->rs.getTimestamp(1).toInstant());
        assertThat(recordedDate).isEqualTo(sessionDate.atStartOfDay().toInstant(ZoneOffset.UTC));

        useClock(Clock.fixed(closesAt,zone));
        assertThat(sessions.openForStudent("student1")).extracting(OpenSessionResponse::id).doesNotContain(sessionId);
        useClock(Clock.fixed(afterMidnight,zone));
        jdbc.update("UPDATE academic.\"AttendanceGeofence\" SET \"isActive\"=FALSE WHERE \"id\"='ute-main-placeholder'");
        assertThat(sessions.openForStudent("student1")).extracting(OpenSessionResponse::id).doesNotContain(sessionId);
        assertThat(store.session(sessionId,false).date()).isEqualTo(sessionDate);
    }
    @Test void acceptedAndFailedAttemptsPersistAndSixthRequestHasRetryAfter() throws Exception {
        for(int i=0;i<5;i++) mvc.perform(post("/api/v1/attendance/sessions/"+id+"/checkin").with(student(1)).contentType(MediaType.APPLICATION_JSON)
                .content(body("d").replaceFirst("\"code\":\"[0-9]{6}\"","\"code\":\"wrong\"")))
                .andExpect(status().isUnprocessableEntity()).andExpect(jsonPath("$.code").value("BAD_CODE"));
        mvc.perform(post("/api/v1/attendance/sessions/"+id+"/checkin").with(student(1)).contentType(MediaType.APPLICATION_JSON).content(body("d")))
                .andExpect(status().isTooManyRequests()).andExpect(header().exists("Retry-After")).andExpect(jsonPath("$.code").value("TOO_MANY_ATTEMPTS"));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM academic.\"AttendanceCheckinAttempt\" WHERE \"sessionId\"=?",Integer.class,id)).isEqualTo(6);
    }
    @Test void manualLecturerAttendanceIsNeverOverwrittenAndLaterOverrideWins() {
        attendance.recordSectionAttendance("section","lecturer",List.of("LECTURER"),new SectionAttendanceUpdateRequest(LocalDate.now(SessionService.CAMPUS_ZONE).toString(),List.of(new StudentAttendanceEntry("student1","EXCUSED","manual"))));
        assertThat(checkins.checkin(id,"student1",request("d1",10),"ip").status()).isEqualTo("MANUAL_RECORD_PRESERVED");
        assertThat(jdbc.queryForObject("SELECT \"status\" FROM academic.\"Attendance\" WHERE \"studentId\"='student1'",String.class)).isEqualTo("EXCUSED");
        checkins.checkin(id,"student2",request("d2",10.0001),"ip");
        attendance.recordSectionAttendance("section","lecturer",List.of("LECTURER"),new SectionAttendanceUpdateRequest(LocalDate.now(SessionService.CAMPUS_ZONE).toString(),List.of(new StudentAttendanceEntry("student2","ABSENT","override"))));
        assertThat(jdbc.queryForObject("SELECT \"checkinId\" FROM academic.\"Attendance\" WHERE \"studentId\"='student2'",String.class)).isNull();
    }
    @Test void simultaneousDuplicateRequestsWriteExactlyOneAttendanceAndTwoAttempts() throws Exception {
        var results=race(()->checkins.checkin(id,"student1",request("d1",10),"ip"),()->checkins.checkin(id,"student1",request("d1",10),"ip"));
        assertThat(results).containsExactlyInAnyOrder("ACCEPTED","ALREADY_CHECKED_IN");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM academic.\"Attendance\"",Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM academic.\"AttendanceCheckinAttempt\"",Integer.class)).isEqualTo(2);
    }
    @Test void simultaneousSharedDeviceUseFlagsBothAndWithdrawsOnlyAutomaticAttendance() throws Exception {
        race(()->checkins.checkin(id,"student1",request("shared",10),"ip"),()->checkins.checkin(id,"student2",request("shared",10.0001),"ip"));
        assertThat(store.checkins(id)).allMatch(c->c.decision().equals("PENDING_REVIEW") && c.reason().equals("SHARED_DEVICE"));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM academic.\"Attendance\"",Integer.class)).isZero();
    }
    @Test void reviewRequiresOwnerAndApprovalUsesOriginalCheckinTime() throws Exception {
        var r=request("mock",10);
        checkins.checkin(id,"student1",new CheckinRequest(r.code(),r.latitude(),r.longitude(),r.accuracyMeters(),r.capturedAt(),true,r.installationId(),null),"ip");
        String c=store.checkins(id).getFirst().id();
        mvc.perform(post("/api/v1/attendance/checkins/"+c+"/review").with(lecturer(true)).contentType(MediaType.APPLICATION_JSON).content("{\"decision\":\"APPROVE\",\"note\":\"checked\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(post("/api/v1/attendance/checkins/"+c+"/review").with(admin()).contentType(MediaType.APPLICATION_JSON).content("{\"decision\":\"APPROVE\",\"note\":\"checked\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.reviewedBy").value("admin-user")).andExpect(jsonPath("$.lat").doesNotExist());
        assertThat(jdbc.queryForObject("SELECT \"status\" FROM academic.\"Attendance\"",String.class)).isEqualTo("PRESENT");
    }
    @Test void fourthIdenticalFixFlagsEntireCluster() {
        for(int i=1;i<=4;i++) checkins.checkin(id,"student"+i,request("device"+i,10),"ip");
        assertThat(store.checkins(id)).allMatch(c->c.decision().equals("PENDING_REVIEW") && c.reason().contains("IDENTICAL_COORDINATES"));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM academic.\"Attendance\"",Integer.class)).isZero();
    }
    @Test void identicalFixAtDecimalRoundingBoundaryStillFlagsEntireCluster() {
        for(int i=1;i<=4;i++) checkins.checkin(id,"student"+i,request("boundary-device"+i,10.0000046),"ip");
        assertThat(store.checkins(id)).allMatch(c->c.decision().equals("PENDING_REVIEW") && c.reason().contains("IDENTICAL_COORDINATES"));
    }
    @Test void laterRiskFlagsPreservePriorRiskAndReviewEvidenceAndAttemptReason() {
        var r=request("shared",10);
        checkins.checkin(id,"student1",new CheckinRequest(r.code(),r.latitude(),r.longitude(),r.accuracyMeters(),r.capturedAt(),true,r.installationId(),null),"ip");
        String c=store.checkins(id).getFirst().id();
        checkins.review(c,new ReviewRequest("APPROVE","verified in person"),"admin-user",null,List.of("ADMIN"));
        checkins.checkin(id,"student2",request("shared",10.0001),"ip");
        var flagged=store.findCheckin(c);
        assertThat(flagged.reason()).contains("MOCK_PROVIDER","SHARED_DEVICE");
        assertThat(flagged.reviewedBy()).isEqualTo("admin-user");
        assertThat(jdbc.queryForObject("SELECT \"reason\" FROM academic.\"AttendanceCheckinAttempt\" WHERE \"sessionId\"=? AND \"studentId\"='student2'",String.class,id)).isEqualTo("SHARED_DEVICE");
    }
    @Test void pendingSameDayFixCountsAsPreviousPositionForImpossibleSpeed() {
        jdbc.update("INSERT INTO academic.\"Section\" (\"id\",\"lecturerId\",\"sectionNumber\") VALUES ('section2','lecturer','B')");
        jdbc.update("INSERT INTO academic.\"Enrollment\" (\"id\",\"sectionId\",\"studentId\",\"status\") VALUES ('enroll-far','section2','student1','ENROLLED')");
        jdbc.update("""
                INSERT INTO academic."AttendanceGeofence" ("id","name","campusCode","centerLat","centerLng","radiusMeters","isActive","createdBy")
                VALUES ('far-fence','Far campus','UTE-FAR',10.18,106,150,TRUE,'admin-user')
                """);
        var far=sessions.open(new OpenSessionRequest("section2",LocalDate.now(SessionService.CAMPUS_ZONE),null,null,10,"far-fence",false),
                "admin-user",null,List.of("ADMIN"));
        var session=store.session(id,false);
        // First fix stays PENDING_REVIEW (accuracy 75 -> BORDERLINE): it is still a
        // real submitted position and must feed the impossible-speed check (§3.5).
        var first=checkins.checkin(id,"student1",
                new CheckinRequest(codes.current(id,session.codeSecret()),10.0,106.0,75.0,Instant.now(),false,"device-a",null),"ip");
        assertThat(first.decision()).isEqualTo("PENDING_REVIEW");
        var second=checkins.checkin(far.id(),"student1",
                new CheckinRequest(null,10.18,106.0,5.0,Instant.now(),false,"device-b",null),"ip");
        assertThat(second.decision()).isEqualTo("PENDING_REVIEW");
        assertThat(second.message()).contains("IMPOSSIBLE_SPEED");
    }
    @Test void outdatedConsentStillExposesCurrentRequiredVersion() throws Exception {
        properties.setConsentVersion("2");
        try {
            mvc.perform(get("/api/v1/attendance/location-consent").with(student(1)))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.accepted").value(false))
                    .andExpect(jsonPath("$.version").value("2")).andExpect(jsonPath("$.acceptedVersion").value("1"));
            mvc.perform(post("/api/v1/attendance/location-consent").with(student(1)).contentType(MediaType.APPLICATION_JSON).content("{\"version\":\"1\"}"))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_CONSENT_VERSION"));
            mvc.perform(post("/api/v1/attendance/location-consent").with(student(1)).contentType(MediaType.APPLICATION_JSON).content("{\"version\":\"2\"}"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.accepted").value(true))
                    .andExpect(jsonPath("$.version").value("2")).andExpect(jsonPath("$.acceptedVersion").value("2"));
            mvc.perform(post("/api/v1/attendance/sessions/"+id+"/checkin").with(student(1)).contentType(MediaType.APPLICATION_JSON).content(body("consent-device")))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.decision").value("ACCEPTED"));
        } finally { properties.setConsentVersion("1"); }
    }
    @Test void wellFormedFabricatedFixIsAccepted_deviceEvidenceIsAdvisoryOnly() throws Exception {
        // Spec §10 residual risk: a fabricated but well-formed payload (valid
        // account + enrolment + in-room code + fresh accurate fix, mockProvider
        // false) is indistinguishable from a real one in this release. Device and
        // risk evidence is advisory until Phase 2 attestation; this pins the
        // documented gap rather than claiming a control that does not exist.
        mvc.perform(post("/api/v1/attendance/sessions/"+id+"/checkin").with(student(1))
                .contentType(MediaType.APPLICATION_JSON).content(body("fabricated-device")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.decision").value("ACCEPTED"));
    }
    @Test void duplicateOpenSessionAndInvalidGeofenceAreRejected() throws Exception {
        assertThatThrownBy(()->sessions.open(new OpenSessionRequest("section",LocalDate.now(SessionService.CAMPUS_ZONE),null,null,10,"ute-main-placeholder",true),"admin-user",null,List.of("ADMIN")))
                .isInstanceOfSatisfying(DomainException.class,e->assertThat(e.code()).isEqualTo("SESSION_ALREADY_OPEN"));
        mvc.perform(post("/api/v1/admin/attendance/geofences").with(admin()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"campus\",\"campusCode\":\"UTE\",\"centerLat\":91,\"centerLng\":106,\"radiusMeters\":150,\"isActive\":true}"))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/v1/attendance/sessions/"+"x".repeat(121)).with(lecturer(false)))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }
    @Test void runtimeOpenApiExportsToTargetForAdditiveContractUpdate() throws Exception {
        String spec=mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat(spec).contains("/api/v1/attendance/sessions/{id}/checkin");
        Path out=Path.of("target","attendance-runtime-openapi.json");Files.createDirectories(out.getParent());Files.writeString(out,spec);
    }
    private List<String> race(Callable<CheckinResponse> a,Callable<CheckinResponse> b) throws Exception {
        var ready=new CountDownLatch(2);var start=new CountDownLatch(1);
        try(var pool=Executors.newFixedThreadPool(2)) {
            var futures=List.of(a,b).stream().map(work->pool.submit(()->{
                ready.countDown();assertThat(start.await(10,TimeUnit.SECONDS)).isTrue();
                try { return work.call().decision(); } catch(DomainException e) { return e.code(); }
            })).toList();
            assertThat(ready.await(10,TimeUnit.SECONDS)).isTrue();start.countDown();
            return List.of(futures.get(0).get(20,TimeUnit.SECONDS),futures.get(1).get(20,TimeUnit.SECONDS));
        }
    }
}
