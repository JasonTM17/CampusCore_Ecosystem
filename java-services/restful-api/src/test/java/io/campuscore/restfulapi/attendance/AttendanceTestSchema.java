package io.campuscore.restfulapi.attendance;

import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

/** Narrow local database fixture with actual V144 applied over its preconditions. */
final class AttendanceTestSchema {
    static void create(JdbcTemplate jdbc,boolean postgres) {
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS academic");
        jdbc.execute("CREATE TABLE IF NOT EXISTS academic.\"Student\" (\"id\" VARCHAR(120) PRIMARY KEY,\"userId\" VARCHAR(120),\"year\" INTEGER)");
        jdbc.execute("CREATE TABLE IF NOT EXISTS academic.\"Section\" (\"id\" VARCHAR(120) PRIMARY KEY,\"lecturerId\" VARCHAR(120),\"sectionNumber\" VARCHAR(40))");
        jdbc.execute("CREATE TABLE IF NOT EXISTS academic.\"Enrollment\" (\"id\" VARCHAR(120) PRIMARY KEY,\"sectionId\" VARCHAR(120),\"studentId\" VARCHAR(120),\"status\" VARCHAR(40))");
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS academic."Attendance" ("id" VARCHAR(120) PRIMARY KEY,"studentId" VARCHAR(120) NOT NULL,"sectionId" VARCHAR(120) NOT NULL,
                "date" TIMESTAMP WITH TIME ZONE NOT NULL,"status" VARCHAR(40) NOT NULL,"notes" VARCHAR(1000),
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,"updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                UNIQUE ("studentId","sectionId","date"))
                """);
        if(postgres) {
            // Real Flyway discovery/validation from a simulated V143 baseline.
            // Earlier catalog migrations are outside this narrow authority fixture.
            org.flywaydb.core.Flyway.configure().dataSource(jdbc.getDataSource()).schemas("academic")
                    .defaultSchema("academic").baselineVersion("143").baselineOnMigrate(true)
                    .locations("classpath:db/migration").load().migrate();
        } else {
            new ResourceDatabasePopulator(new ClassPathResource("db/migration-h2/V144__attendance_geofence.sql"))
                    .execute(jdbc.getDataSource());
        }
        new ResourceDatabasePopulator(new ClassPathResource("db/migration-h2/V18__admin_audit_trail.sql")).execute(jdbc.getDataSource());
    }
    static void clear(JdbcTemplate jdbc) {
        for(String table:new String[]{"Attendance","AttendanceCheckinAttempt","AttendanceCheckin","AttendanceSession","AttendanceLocationConsent","Enrollment","Student","Section"})
            jdbc.update("DELETE FROM academic.\""+table+"\"");
        jdbc.update("UPDATE academic.\"AttendanceGeofence\" SET \"isActive\"=TRUE,\"centerLat\"=10,\"centerLng\"=106 WHERE \"id\"='ute-main-placeholder'");
        jdbc.update("INSERT INTO academic.\"Section\" (\"id\",\"lecturerId\",\"sectionNumber\") VALUES ('section','lecturer','A')");
        for(int i=1;i<=5;i++) {
            jdbc.update("INSERT INTO academic.\"Student\" (\"id\",\"userId\",\"year\") VALUES (?,?,2026)","student"+i,"user"+i);
            if(i<5) jdbc.update("INSERT INTO academic.\"Enrollment\" (\"id\",\"sectionId\",\"studentId\",\"status\") VALUES (?,'section',?,'ENROLLED')","enroll"+i,"student"+i);
        }
    }
}
