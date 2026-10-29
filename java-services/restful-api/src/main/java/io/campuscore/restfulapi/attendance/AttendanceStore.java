package io.campuscore.restfulapi.attendance;

import static io.campuscore.restfulapi.attendance.AttendanceDtos.*;
import io.campuscore.restfulapi.web.DomainException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** All SQL is parameterized; lock order: section, student, session, geofence. */
@Repository
@Profile("persistence")
public class AttendanceStore {
    private final JdbcTemplate jdbc;
    public AttendanceStore(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    public record Session(String id, String sectionId, LocalDate date, String geofenceId, Instant opensAt,
            Instant closesAt, int lateAfterMinutes, boolean requireCode, String status, String codeSecret) {
        public boolean openAt(Instant now) { return status.equals("OPEN") && !now.isBefore(opensAt) && now.isBefore(closesAt); }
        @Override public String toString() { return "AttendanceSession[" + id + "]"; }
    }
    public record Checkin(String id, String sessionId, String studentId, String deviceHash, String decision,
            String reason, double distanceMeters, double accuracyMeters, Double lat, Double lng,
            boolean mockProvider, Instant capturedAt, Instant createdAt, String reviewedBy,
            Instant reviewedAt, String reviewNote) {
        public CheckinView view() { return new CheckinView(id, sessionId, studentId, decision, reason,
                distanceMeters, accuracyMeters, mockProvider, capturedAt, createdAt, reviewedBy, reviewedAt, reviewNote); }
        @Override public String toString() { return "AttendanceCheckin[" + id + "]"; }
    }
    public Session session(String id, boolean lock) {
        List<Session> rows = jdbc.query("SELECT * FROM academic.\"AttendanceSession\" WHERE \"id\"=?" + (lock ? " FOR UPDATE" : ""),
                (rs,n) -> new Session(rs.getString("id"), rs.getString("sectionId"), rs.getObject("attendanceDate", LocalDate.class),
                        rs.getString("geofenceId"), instant(rs,"opensAt"), instant(rs,"closesAt"), rs.getInt("lateAfterMinutes"),
                        rs.getBoolean("requireCode"), rs.getString("status"), rs.getString("codeSecret")), id);
        return rows.isEmpty() ? null : rows.getFirst();
    }
    public void lockSection(String id) {
        if (jdbc.queryForList("SELECT \"id\" FROM academic.\"Section\" WHERE \"id\"=? FOR UPDATE", String.class, id).isEmpty())
            throw new DomainException(HttpStatus.NOT_FOUND, "SECTION_NOT_FOUND", "Section not found");
    }
    public void lockStudent(String id) {
        if (jdbc.queryForList("SELECT \"id\" FROM academic.\"Student\" WHERE \"id\"=? FOR UPDATE", String.class, id).isEmpty())
            throw new DomainException(HttpStatus.FORBIDDEN, "NOT_ENROLLED", "Student identity required");
    }
    public GeofenceResponse geofence(String id, boolean lock) {
        List<GeofenceResponse> rows = jdbc.query("SELECT * FROM academic.\"AttendanceGeofence\" WHERE \"id\"=?" + (lock ? " FOR UPDATE" : ""),
                (rs,n) -> geofence(rs), id);
        if (rows.isEmpty()) throw new DomainException(HttpStatus.NOT_FOUND, "GEOFENCE_NOT_FOUND", "Geofence not found");
        return rows.getFirst();
    }
    private static GeofenceResponse geofence(ResultSet rs) throws SQLException {
        return new GeofenceResponse(rs.getString("id"),rs.getString("name"),rs.getString("campusCode"),
                rs.getDouble("centerLat"),rs.getDouble("centerLng"),rs.getInt("radiusMeters"),rs.getBoolean("isActive"),rs.getString("note"));
    }
    public List<GeofenceResponse> geofences() {
        return jdbc.query("SELECT * FROM academic.\"AttendanceGeofence\" ORDER BY \"name\",\"id\"", (rs,n) -> geofence(rs));
    }
    public void saveGeofence(String id, GeofenceRequest r, String actor, boolean create, Instant now) {
        if (create) jdbc.update("""
                INSERT INTO academic."AttendanceGeofence" ("id","name","campusCode","centerLat","centerLng","radiusMeters","isActive","note","createdBy","createdAt","updatedAt")
                VALUES (?,?,?,?,?,?,?,?,?,?,?)
                """, id,r.name(),r.campusCode(),r.centerLat(),r.centerLng(),r.radiusMeters(),r.isActive(),r.note(),actor,ts(now),ts(now));
        else jdbc.update("""
                UPDATE academic."AttendanceGeofence" SET "name"=?,"campusCode"=?,"centerLat"=?,"centerLng"=?,"radiusMeters"=?,"isActive"=?,"note"=?,"updatedAt"=? WHERE "id"=?
                """,r.name(),r.campusCode(),r.centerLat(),r.centerLng(),r.radiusMeters(),r.isActive(),r.note(),ts(now),id);
    }
    public void createSession(Session s, String actor, Instant now) {
        jdbc.update("""
                INSERT INTO academic."AttendanceSession" ("id","sectionId","attendanceDate","geofenceId","opensAt","closesAt","lateAfterMinutes","requireCode","status","codeSecret","openedBy","createdAt")
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                """,s.id(),s.sectionId(),s.date(),s.geofenceId(),ts(s.opensAt()),ts(s.closesAt()),s.lateAfterMinutes(),s.requireCode(),s.status(),s.codeSecret(),actor,ts(now));
    }
    public boolean hasOpenSession(String section, LocalDate date) {
        return count("SELECT COUNT(*) FROM academic.\"AttendanceSession\" WHERE \"sectionId\"=? AND \"attendanceDate\"=? AND \"status\"='OPEN'",section,date)>0;
    }
    public void close(String id, Instant now) {
        jdbc.update("UPDATE academic.\"AttendanceSession\" SET \"status\"='CLOSED',\"closedAt\"=? WHERE \"id\"=? AND \"status\"='OPEN'",ts(now),id);
    }
    public int closeExpired(Instant now) {
        return jdbc.update("UPDATE academic.\"AttendanceSession\" SET \"status\"='CLOSED',\"closedAt\"=\"closesAt\" WHERE \"status\"='OPEN' AND \"closesAt\"<=?",ts(now));
    }
    public void closeExpiredSection(String section, Instant now) {
        jdbc.update("UPDATE academic.\"AttendanceSession\" SET \"status\"='CLOSED',\"closedAt\"=\"closesAt\" WHERE \"sectionId\"=? AND \"status\"='OPEN' AND \"closesAt\"<=?",section,ts(now));
    }
    public SessionResponse summary(Session s, Instant now, long enrolled) {
        return new SessionResponse(s.id(),s.sectionId(),s.date(),s.geofenceId(),s.opensAt(),s.closesAt(),s.lateAfterMinutes(),s.requireCode(),
                s.status().equals("OPEN") && !now.isBefore(s.closesAt()) ? "CLOSED" : s.status(),
                decisionCount(s.id(),"ACCEPTED"),decisionCount(s.id(),"PENDING_REVIEW"),decisionCount(s.id(),"REJECTED"),enrolled);
    }
    private long decisionCount(String session, String decision) {
        return count("SELECT COUNT(*) FROM academic.\"AttendanceCheckin\" WHERE \"sessionId\"=? AND \"decision\"=?",session,decision);
    }
    public List<OpenSessionResponse> openForStudent(String student, LocalDate date, Instant now) {
        return jdbc.query("""
                SELECT s."id",s."sectionId",sec."sectionNumber",s."closesAt",s."requireCode",g."name"
                FROM academic."AttendanceSession" s JOIN academic."Enrollment" e ON e."sectionId"=s."sectionId"
                JOIN academic."Section" sec ON sec."id"=s."sectionId"
                JOIN academic."AttendanceGeofence" g ON g."id"=s."geofenceId"
                WHERE e."studentId"=? AND e."status" NOT IN ('DROPPED','CANCELLED') AND s."attendanceDate"=?
                AND s."status"='OPEN' AND s."opensAt"<=? AND s."closesAt">? AND g."isActive"=TRUE ORDER BY s."closesAt",s."id"
                """, (rs,n)->new OpenSessionResponse(rs.getString(1),rs.getString(2),rs.getString(3),rs.getTimestamp(4).toInstant(),rs.getBoolean(5),rs.getString(6)),student,date,ts(now),ts(now));
    }
    private Checkin checkin(ResultSet rs) throws SQLException {
        return new Checkin(rs.getString("id"),rs.getString("sessionId"),rs.getString("studentId"),rs.getString("deviceHash"),
                rs.getString("decision"),rs.getString("reason"),rs.getDouble("distanceMeters"),rs.getDouble("accuracyMeters"),
                nullableDouble(rs,"lat"),nullableDouble(rs,"lng"),rs.getBoolean("mockProvider"),
                instant(rs,"capturedAt"),instant(rs,"createdAt"),rs.getString("reviewedBy"),instant(rs,"reviewedAt"),rs.getString("reviewNote"));
    }
    public List<Checkin> checkins(String session) {
        return jdbc.query("SELECT * FROM academic.\"AttendanceCheckin\" WHERE \"sessionId\"=? ORDER BY \"createdAt\",\"id\"",(rs,n)->checkin(rs),session);
    }
    public Checkin findCheckin(String id) {
        List<Checkin> rows=jdbc.query("SELECT * FROM academic.\"AttendanceCheckin\" WHERE \"id\"=?",(rs,n)->checkin(rs),id);
        if(rows.isEmpty()) throw new DomainException(HttpStatus.NOT_FOUND,"CHECKIN_NOT_FOUND","Check-in not found");
        return rows.getFirst();
    }
    public RiskEvaluator.Position previousAccepted(String student) {
        List<RiskEvaluator.Position> rows=jdbc.query("""
                SELECT "lat","lng","capturedAt" FROM academic."AttendanceCheckin"
                WHERE "studentId"=? AND "decision"='ACCEPTED' AND "lat" IS NOT NULL
                ORDER BY "createdAt" DESC,"id" DESC LIMIT 1
                """,(rs,n)->new RiskEvaluator.Position(rs.getDouble(1),rs.getDouble(2),rs.getTimestamp(3).toInstant()),student);
        return rows.isEmpty()?null:rows.getFirst();
    }
    public void insertCheckin(Checkin c) {
        jdbc.update("""
                INSERT INTO academic."AttendanceCheckin" ("id","sessionId","studentId","deviceHash","decision","reason","distanceMeters","accuracyMeters","lat","lng","mockProvider","capturedAt","createdAt")
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,c.id(),c.sessionId(),c.studentId(),c.deviceHash(),c.decision(),c.reason(),c.distanceMeters(),c.accuracyMeters(),c.lat(),c.lng(),c.mockProvider(),ts(c.capturedAt()),ts(c.createdAt()));
    }
    public void flag(Checkin c, String reason) {
        // Preserve earlier risk evidence, including another flag applied in this transaction.
        String previous=findCheckin(c.id()).reason();
        String combined=java.util.stream.Stream.concat(java.util.Arrays.stream(previous.split(",")),java.util.Arrays.stream(reason.split(",")))
                .filter(value->!value.equals("INSIDE")).distinct().collect(java.util.stream.Collectors.joining(","));
        jdbc.update("UPDATE academic.\"AttendanceCheckin\" SET \"decision\"='PENDING_REVIEW',\"reason\"=? WHERE \"id\"=?",combined,c.id());
        // Only remove attendance created by this check-in. Manual replacements have checkinId NULL.
        jdbc.update("DELETE FROM academic.\"Attendance\" WHERE \"checkinId\"=?",c.id());
    }
    public void review(String id,String decision,String actor,String note,Instant now) {
        jdbc.update("UPDATE academic.\"AttendanceCheckin\" SET \"decision\"=?,\"reviewedBy\"=?,\"reviewedAt\"=?,\"reviewNote\"=? WHERE \"id\"=?",decision,actor,ts(now),note,id);
    }
    public ConsentResponse consent(String student,String required) {
        List<ConsentResponse> rows=jdbc.query("SELECT \"version\",\"acceptedAt\" FROM academic.\"AttendanceLocationConsent\" WHERE \"studentId\"=?",
                (rs,n)->new ConsentResponse(required.equals(rs.getString(1)),rs.getString(1),rs.getTimestamp(2).toInstant()),student);
        return rows.isEmpty()?new ConsentResponse(false,required,null):rows.getFirst();
    }
    public void saveConsent(String student,String version,Instant now) {
        jdbc.update("DELETE FROM academic.\"AttendanceLocationConsent\" WHERE \"studentId\"=?",student);
        jdbc.update("INSERT INTO academic.\"AttendanceLocationConsent\" (\"studentId\",\"version\",\"acceptedAt\") VALUES (?,?,?)",student,version,ts(now));
    }
    public void attempt(String session,String student,String outcome,String ipHash,String requestHash,Instant now,boolean exists) {
        attempt(session,student,outcome,outcome,ipHash,requestHash,now,exists);
    }
    public void attempt(String session,String student,String outcome,String reason,String ipHash,String requestHash,Instant now,boolean exists) {
        jdbc.update("""
                INSERT INTO academic."AttendanceCheckinAttempt" ("id","sessionId","requestedSessionId","studentId","outcome","reason","ipHash","requestHash","createdAt") VALUES (?,?,?,?,?,?,?,?,?)
                """,UUID.randomUUID().toString(),exists?session:null,session,student,outcome,reason,ipHash,requestHash,ts(now));
    }
    public long studentAttempts(String session,String student,Instant cutoff) {
        return count("SELECT COUNT(*) FROM academic.\"AttendanceCheckinAttempt\" WHERE \"sessionId\"=? AND \"studentId\"=? AND \"createdAt\">?",session,student,ts(cutoff));
    }
    public long ipAttempts(String session,String ip,Instant cutoff) {
        return count("SELECT COUNT(*) FROM academic.\"AttendanceCheckinAttempt\" WHERE \"sessionId\"=? AND \"ipHash\"=? AND \"createdAt\">?",session,ip,ts(cutoff));
    }
    public boolean replayed(String session,String student,String hash) {
        return count("SELECT COUNT(*) FROM academic.\"AttendanceCheckinAttempt\" WHERE \"sessionId\"=? AND \"studentId\"=? AND \"requestHash\"=?",session,student,hash)>0;
    }
    public int eraseCoordinates(LocalDate cutoff) {
        return jdbc.update("""
                UPDATE academic."AttendanceCheckin" SET "lat"=NULL,"lng"=NULL WHERE "lat" IS NOT NULL
                AND "sessionId" IN (SELECT "id" FROM academic."AttendanceSession" WHERE "attendanceDate"<=?)
                """,cutoff);
    }
    public int purgeAttempts(Instant cutoff) {
        return jdbc.update("DELETE FROM academic.\"AttendanceCheckinAttempt\" WHERE \"createdAt\"<=?",ts(cutoff));
    }
    private long count(String sql,Object...args) { Long n=jdbc.queryForObject(sql,Long.class,args); return n==null?0:n; }
    public static Object ts(Instant value) { return value==null?null:value.atOffset(ZoneOffset.UTC); }
    private static Instant instant(ResultSet rs,String name) throws SQLException {
        java.sql.Timestamp t=rs.getTimestamp(name); return t==null?null:t.toInstant();
    }
    private static Double nullableDouble(ResultSet rs,String name) throws SQLException {
        java.math.BigDecimal value=rs.getBigDecimal(name);return value==null?null:value.doubleValue();
    }
}
