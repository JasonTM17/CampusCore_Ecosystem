package io.campuscore.restfulapi.attendance;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.mock;
import static io.campuscore.restfulapi.attendance.AttendanceDtos.*;
import io.campuscore.restfulapi.academic.repository.AcademicAttendanceWriteRepository;
import io.campuscore.restfulapi.academic.service.AcademicAttendanceWriteService;
import io.campuscore.restfulapi.academic.web.AcademicAttendanceMutationDtos.*;
import io.campuscore.restfulapi.audit.AdminAuditRecorder;
import io.campuscore.restfulapi.security.ratelimit.RateLimiterService;
import io.campuscore.restfulapi.web.DomainException;
import java.time.*;
import java.util.List;
import java.util.concurrent.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import org.springframework.transaction.support.TransactionTemplate;

/** Local-only PostgreSQL authority: V144 DDL, constraints and real transaction locks.
 * Never accepts arbitrary CAMPUSCORE/SPRING datasource environment variables.
 */
@EnabledIf("localTargetConfigured")
class AttendanceGeofencePostgresIT {
    private JdbcTemplate jdbc;
    private AttendanceStore store;
    private SessionService sessions;
    private CheckinService checkins;
    private AcademicAttendanceWriteService attendance;
    private DataSourceTransactionManager manager;
    private final Instant now=Instant.parse("2026-10-29T03:00:00Z");
    private final Clock clock=Clock.fixed(now,ZoneOffset.UTC);
    private String id;
    static boolean localTargetConfigured() {
        String url=System.getenv("ATTENDANCE_LOCAL_POSTGRES_URL");
        return url!=null && url.matches("jdbc:postgresql://(127\\.0\\.0\\.1|localhost):[0-9]+/attendance_g1_test");
    }
    @BeforeEach void fixture() {
        if(!localTargetConfigured()) throw new IllegalStateException("Only a disposable loopback attendance_g1_test database is allowed");
        var ds=new DriverManagerDataSource(System.getenv("ATTENDANCE_LOCAL_POSTGRES_URL"),"postgres","");
        jdbc=new JdbcTemplate(ds);manager=new DataSourceTransactionManager(ds);
        AttendanceTestSchema.create(jdbc,true);AttendanceTestSchema.clear(jdbc);
        store=new AttendanceStore(jdbc);
        var p=CodeServiceTest.properties();var academic=new AcademicAttendanceWriteRepository(new NamedParameterJdbcTemplate(jdbc));
        attendance=transactional(new AcademicAttendanceWriteService(academic));
        var code=new CodeService(clock,p);var audit=mock(AdminAuditRecorder.class);
        sessions=transactional(new SessionService(store,academic,code,clock,audit));
        checkins=transactional(new CheckinService(store,sessions,academic,attendance,code,new GeofenceVerifier(clock),new RiskEvaluator(p),new RateLimiterService(clock),p,audit,clock));
        id=sessions.open(new OpenSessionRequest("section",LocalDate.parse("2026-10-29"),now.minusSeconds(30),now.plusSeconds(900),10,"ute-main-placeholder",false),"admin",null,List.of("ADMIN")).id();
        for(int i=1;i<=4;i++) checkins.acceptConsent("student"+i,"1");
    }
    @SuppressWarnings("unchecked") private <T>T transactional(T target) {
        var factory=new ProxyFactory(target);factory.setProxyTargetClass(true);
        factory.addAdvice(new TransactionInterceptor(manager,new AnnotationTransactionAttributeSource()));
        return (T)factory.getProxy();
    }
    private CheckinRequest request(String device,double lat) { return new CheckinRequest(null,lat,106.0,5.0,now,false,device,null); }
    @Test void partialUniqueIndexesAllowClosedSessionsAndRejectedHistoryOnly() {
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM academic.flyway_schema_history WHERE version='144' AND success=TRUE",Integer.class)).isEqualTo(1);
        var s=store.session(id,false);
        var other=new AttendanceStore.Session("other","section",s.date(),s.geofenceId(),s.opensAt(),s.closesAt(),10,false,"OPEN",s.codeSecret());
        assertThatThrownBy(()->store.createSession(other,"admin",now)).isInstanceOf(DataIntegrityViolationException.class);
        store.close(id,now);store.createSession(other,"admin",now);
        var c=new AttendanceStore.Checkin("c","other","student1","0".repeat(64),"ACCEPTED","INSIDE",0,5,10.0,106.0,false,now,now,null,null,null);
        store.insertCheckin(c);
        var duplicate=new AttendanceStore.Checkin("c2","other","student1","1".repeat(64),"PENDING_REVIEW","BORDERLINE",0,5,10.0,106.0,false,now,now,null,null,null);
        assertThatThrownBy(()->store.insertCheckin(duplicate)).isInstanceOf(DataIntegrityViolationException.class);
        store.review("c","REJECTED","admin","not present",now);store.insertCheckin(duplicate);
    }
    @Test void migrationRejectsInvalidRangesWindowsAndMissingReferences() {
        for(String mutation:new String[]{"\"centerLat\"=91","\"centerLng\"=-181","\"radiusMeters\"=29"})
            assertThatThrownBy(()->jdbc.update("UPDATE academic.\"AttendanceGeofence\" SET "+mutation+" WHERE \"id\"='ute-main-placeholder'"))
                    .isInstanceOf(DataIntegrityViolationException.class);
        for(String mutation:new String[]{"\"closesAt\"=\"opensAt\"","\"closesAt\"=\"opensAt\"+INTERVAL '61 minutes'","\"lateAfterMinutes\"=-1","\"geofenceId\"='missing'"})
            assertThatThrownBy(()->jdbc.update("UPDATE academic.\"AttendanceSession\" SET "+mutation+" WHERE \"id\"=?",id))
                    .isInstanceOf(DataIntegrityViolationException.class);
    }
    @Test void duplicateStudentRaceCommitsExactlyOneCheckinAndTwoAttempts() throws Exception {
        var results=race(()->checkins.checkin(id,"student1",request("a",10),"ip"),()->checkins.checkin(id,"student1",request("b",10),"ip"));
        assertThat(results).containsExactlyInAnyOrder("ACCEPTED","ALREADY_CHECKED_IN");
        assertThat(store.checkins(id)).hasSize(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM academic.\"Attendance\"",Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM academic.\"AttendanceCheckinAttempt\"",Integer.class)).isEqualTo(2);
    }
    @Test void sharedDeviceRaceCommitsBothToReviewAndPreservesManualRecord() throws Exception {
        attendance.recordSectionAttendance("section","lecturer",List.of("LECTURER"),new SectionAttendanceUpdateRequest("2026-10-29",List.of(new StudentAttendanceEntry("student1","EXCUSED","manual"))));
        race(()->checkins.checkin(id,"student1",request("shared",10),"ip"),()->checkins.checkin(id,"student2",request("shared",10.0001),"ip"));
        assertThat(store.checkins(id)).allMatch(c->c.decision().equals("PENDING_REVIEW") && c.reason().equals("SHARED_DEVICE"));
        assertThat(jdbc.queryForObject("SELECT \"status\" FROM academic.\"Attendance\"",String.class)).isEqualTo("EXCUSED");
    }
    @Test void heldSectionLockBlocksStudentUntilManualCommitThenPreservesManualAttendance() throws Exception {
        var locked=new CountDownLatch(1);var release=new CountDownLatch(1);var started=new CountDownLatch(1);
        try(var pool=Executors.newFixedThreadPool(2)) {
            var manual=pool.submit(()->new TransactionTemplate(manager).executeWithoutResult(tx->{
                store.lockSection("section");
                attendance.recordSectionAttendance("section","lecturer",List.of("LECTURER"),new SectionAttendanceUpdateRequest("2026-10-29",List.of(new StudentAttendanceEntry("student1","ABSENT","manual"))));
                locked.countDown();try { if(!release.await(10,TimeUnit.SECONDS)) throw new AssertionError("release timeout"); }
                catch(InterruptedException e) { Thread.currentThread().interrupt();throw new AssertionError(e); }
            }));
            assertThat(locked.await(10,TimeUnit.SECONDS)).isTrue();
            var student=pool.submit(()->{started.countDown();return checkins.checkin(id,"student1",request("d",10),"ip");});
            assertThat(started.await(10,TimeUnit.SECONDS)).isTrue();
            // Database receipt proves this is a lock wait, rather than scheduler timing.
            long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(10);boolean blocked=false;
            while(System.nanoTime()<deadline) {
                if(jdbc.queryForObject("SELECT COUNT(*) FROM pg_stat_activity WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid))>0",Integer.class)>0) { blocked=true;break; }
                Thread.sleep(10);
            }
            release.countDown();manual.get(10,TimeUnit.SECONDS);
            assertThat(blocked).isTrue();assertThat(student.get(10,TimeUnit.SECONDS).status()).isEqualTo("MANUAL_RECORD_PRESERVED");
            assertThat(jdbc.queryForObject("SELECT \"status\" FROM academic.\"Attendance\"",String.class)).isEqualTo("ABSENT");
        } finally { release.countDown(); }
    }
    @Test void rejectedAttemptsCommitAndRetentionErasesOnlyExpiredCoordinates() {
        assertThatThrownBy(()->checkins.checkin(id,"student1",request("d",11),"ip")).isInstanceOf(DomainException.class);
        assertThat(jdbc.queryForObject("SELECT \"outcome\" FROM academic.\"AttendanceCheckinAttempt\"",String.class)).isEqualTo("OUTSIDE_AREA");
        checkins.checkin(id,"student1",request("d",10),"ip");
        assertThat(store.eraseCoordinates(LocalDate.parse("2026-10-28"))).isZero();
        assertThat(store.eraseCoordinates(LocalDate.parse("2026-10-29"))).isEqualTo(1);
        assertThat(store.checkins(id).getFirst().lat()).isNull();
        assertThat(store.checkins(id).getFirst().decision()).isEqualTo("ACCEPTED");
        assertThat(store.purgeAttempts(now.minusSeconds(1))).isZero();assertThat(store.purgeAttempts(now)).isEqualTo(2);
    }
    @Test void coordinateClusteringIsStableAcrossDatabasePrecisionBoundaries() {
        for(int i=1;i<=4;i++) checkins.checkin(id,"student"+i,request("precision-device"+i,10.0000046),"ip");
        assertThat(store.checkins(id)).allMatch(c->c.decision().equals("PENDING_REVIEW") && c.reason().contains("IDENTICAL_COORDINATES"));
    }
    private List<String> race(Callable<CheckinResponse>a,Callable<CheckinResponse>b) throws Exception {
        var ready=new CountDownLatch(2);var start=new CountDownLatch(1);
        try(var pool=Executors.newFixedThreadPool(2)) {
            var fs=List.of(a,b).stream().map(work->pool.submit(()->{
                ready.countDown();if(!start.await(10,TimeUnit.SECONDS)) throw new AssertionError("start timeout");
                try{return work.call().decision();}catch(DomainException e){return e.code();}
            })).toList();
            assertThat(ready.await(10,TimeUnit.SECONDS)).isTrue();start.countDown();
            return List.of(fs.get(0).get(20,TimeUnit.SECONDS),fs.get(1).get(20,TimeUnit.SECONDS));
        }
    }
}
