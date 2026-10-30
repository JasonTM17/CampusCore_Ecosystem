package io.campuscore.restfulapi.attendance;

import static org.mockito.Mockito.*;
import java.time.*;
import org.junit.jupiter.api.Test;

class AttendanceRetentionJobTest {
    @Test void retentionUsesCampusCalendarDayAndIndependentNinetyDayAttemptCutoff() {
        var store=mock(AttendanceStore.class);
        Instant now=Instant.parse("2026-10-29T18:00:00Z");
        new AttendanceRetentionJob(store,new AttendanceCheckinProperties(),Clock.fixed(now,ZoneOffset.UTC)).retain();
        verify(store).eraseCoordinates(LocalDate.parse("2026-09-30"));
        verify(store).purgeAttempts(now.minusSeconds(90L*86400));
    }
    @Test void configurableRetentionAndSessionSweeperUseInjectedClock() {
        var store=mock(AttendanceStore.class);var p=new AttendanceCheckinProperties();
        p.setCoordinateRetentionDays(7);p.setAttemptRetentionDays(14);
        Instant now=Instant.parse("2026-10-29T03:00:00Z");
        var job=new AttendanceRetentionJob(store,p,Clock.fixed(now,ZoneOffset.UTC));job.retain();job.closeExpired();
        verify(store).eraseCoordinates(LocalDate.parse("2026-10-22"));
        verify(store).purgeAttempts(now.minusSeconds(14L*86400));verify(store).closeExpired(now);
    }
}
