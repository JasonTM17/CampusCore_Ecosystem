package io.campuscore.restfulapi.attendance;

import java.time.Clock;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Idempotent SQL makes sweeps safe across replicas; no location data is logged. */
@Component
@Profile("persistence")
@ConditionalOnProperty(prefix="attendance.checkin",name="jobs-enabled",havingValue="true",matchIfMissing=true)
public class AttendanceRetentionJob {
    private final AttendanceStore store;
    private final AttendanceCheckinProperties properties;
    private final Clock clock;
    public AttendanceRetentionJob(AttendanceStore store,AttendanceCheckinProperties properties,@Qualifier("attendanceClock") Clock clock) {
        this.store=store;this.properties=properties;this.clock=clock;
    }
    @Scheduled(cron="${attendance.checkin.retention-cron:0 23 3 * * *}",zone="Asia/Ho_Chi_Minh")
    @Transactional
    public void retain() {
        store.eraseCoordinates(LocalDate.now(clock.withZone(SessionService.CAMPUS_ZONE)).minusDays(properties.getCoordinateRetentionDays()));
        store.purgeAttempts(clock.instant().minus(properties.getAttemptRetentionDays(),ChronoUnit.DAYS));
    }
    @Scheduled(fixedDelayString="${attendance.checkin.sweep-delay-ms:30000}")
    @Transactional
    public void closeExpired() { store.closeExpired(clock.instant()); }
}
