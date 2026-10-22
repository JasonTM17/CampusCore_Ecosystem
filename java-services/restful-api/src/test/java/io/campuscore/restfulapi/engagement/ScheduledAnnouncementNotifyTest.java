package io.campuscore.restfulapi.engagement;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import tools.jackson.databind.ObjectMapper;
import io.campuscore.restfulapi.engagement.repository.AnnouncementAuditRepository;
import io.campuscore.restfulapi.engagement.repository.AnnouncementWriteRepository;
import io.campuscore.restfulapi.engagement.service.AnnouncementStudentNotifier;
import io.campuscore.restfulapi.engagement.service.AnnouncementWriteService;
import io.campuscore.restfulapi.engagement.service.ScheduledAnnouncementNotifyJob;
import io.campuscore.restfulapi.engagement.web.AnnouncementReadDtos.AnnouncementResponse;
import io.campuscore.restfulapi.engagement.web.AnnouncementWriteDtos.CreateAnnouncementRequest;
import io.campuscore.restfulapi.engagement.web.AnnouncementWriteDtos.UpdateAnnouncementRequest;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

/** Marker contract for the scheduled-announcement notification refire (V104). */
class ScheduledAnnouncementNotifyTest {

    // Wall-clock-relative base: the service and job compare publishAt against
    // Instant.now() at call time, so a fixed epoch would silently flip these
    // fixtures' due/not-due meaning once the calendar passes it.
    private static final Instant NOW = Instant.now();

    @Test
    void approveStampsNotifiedOnlyWhenVisibleNow() throws Exception {
        // The fan-out trigger moved to approve: create lands DRAFT and never
        // notifies; approval of an immediate row (publishAt NULL) fires it.
        AnnouncementWriteRepository announcements = mock(AnnouncementWriteRepository.class);
        AnnouncementStudentNotifier notifier = mock(AnnouncementStudentNotifier.class);
        AnnouncementWriteService service = service(announcements, notifier);
        when(announcements.findByIdForUpdate("notice-1")).thenReturn(Optional.of(inReview()));
        when(announcements.approveForPublication(eq("notice-1"), eq(0), eq("admin-2"), any())).thenReturn(1);
        when(announcements.findById("notice-1")).thenReturn(Optional.of(announcement(null)));

        service.approve("admin-2", "Admin Two", List.of("ADMIN"), "notice-1");

        verify(notifier).notifyAfterPublication("notice-1");
    }

    @Test
    void createNeverNotifiesBeforeReview() throws Exception {
        AnnouncementWriteRepository announcements = mock(AnnouncementWriteRepository.class);
        AnnouncementStudentNotifier notifier = mock(AnnouncementStudentNotifier.class);
        AnnouncementWriteService service = service(announcements, notifier);
        Instant future = NOW.plusSeconds(3600);
        when(announcements.create(any())).thenReturn(announcement(future));

        service.create("admin-1", "Admin", List.of("ADMIN"), null, createRequest(future));

        verify(notifier, never()).notifyAfterPublication(any());
        verify(announcements, never()).markNotified(any(), any());
    }

    @Test
    void failedFanOutReArmsTheClaimSoTheJobRetries() throws Exception {
        AnnouncementWriteRepository announcements = mock(AnnouncementWriteRepository.class);
        AnnouncementStudentNotifier notifier = mock(AnnouncementStudentNotifier.class);
        AnnouncementWriteService service = service(announcements, notifier);
        when(announcements.findByIdForUpdate("notice-1")).thenReturn(Optional.of(inReview()));
        when(announcements.approveForPublication(eq("notice-1"), eq(0), eq("admin-2"), any())).thenReturn(1);
        when(announcements.findById("notice-1")).thenReturn(Optional.of(announcement(null)));
        when(notifier.notifyAfterPublication(any())).thenThrow(new RuntimeException("inbox down"));

        service.approve("admin-2", "Admin Two", List.of("ADMIN"), "notice-1");

        // Claim and inbox write are owned by the notifier's one new transaction.
        // Its rollback/retry eligibility is checked by the persistence test.
        verify(notifier).notifyAfterPublication("notice-1");
        verify(announcements, never()).markNotified(any(), any());
    }

    @Test
    void reschedulingPublishAtIntoFutureReArmsTheMarker() throws Exception {
        AnnouncementWriteRepository announcements = mock(AnnouncementWriteRepository.class);
        AnnouncementWriteService service = service(announcements, mock(AnnouncementStudentNotifier.class));
        AnnouncementResponse existing = draft();
        when(announcements.findByIdForUpdate("notice-1")).thenReturn(Optional.of(existing));
        when(announcements.findById("notice-1")).thenReturn(Optional.of(existing));
        when(announcements.update(any())).thenReturn(1);
        UpdateAnnouncementRequest request = new UpdateAnnouncementRequest(
                Set.of("publishAt", "reason", "expectedVersion"),
                null, null, null, null, null, null,
                NOW.plusSeconds(7200), null, null, null, null, "Reschedule", 0);

        service.update("admin-1", "admin@campuscore.edu", List.of("ADMIN"), null, "notice-1", request);

        verify(announcements).clearNotifiedAt("notice-1");
    }

    @Test
    void jobFansOutAndStampsEachDueAnnouncement() {
        AnnouncementWriteRepository announcements = mock(AnnouncementWriteRepository.class);
        AnnouncementStudentNotifier notifier = mock(AnnouncementStudentNotifier.class);
        ScheduledAnnouncementNotifyJob job = new ScheduledAnnouncementNotifyJob(announcements, notifier);
        when(announcements.findDueForNotification(any(), anyInt()))
                .thenReturn(List.of(announcement(NOW.minusSeconds(60))));
        when(notifier.notifyAfterPublication("notice-1")).thenReturn(3);

        job.refireDueAnnouncements();

        verify(notifier).notifyAfterPublication("notice-1");
    }

    @Test
    void jobSkipsFanOutWhenClaimIsLostToAnotherWorker() {
        AnnouncementWriteRepository announcements = mock(AnnouncementWriteRepository.class);
        AnnouncementStudentNotifier notifier = mock(AnnouncementStudentNotifier.class);
        ScheduledAnnouncementNotifyJob job = new ScheduledAnnouncementNotifyJob(announcements, notifier);
        when(announcements.findDueForNotification(any(), anyInt()))
                .thenReturn(List.of(announcement(NOW.minusSeconds(60))));
        when(notifier.notifyAfterPublication("notice-1")).thenReturn(0);

        job.refireDueAnnouncements();

        verify(notifier, never()).fanOutToActiveStudents(any());
        verify(notifier).notifyAfterPublication("notice-1");
        verify(announcements, never()).clearNotifiedAt(any());
        verify(announcements, never()).clearNotifiedAt(any(), any());
    }

    @Test
    void jobReArmsMarkerWhenFanOutThrowsSoRowRetriesNextTick() {
        AnnouncementWriteRepository announcements = mock(AnnouncementWriteRepository.class);
        AnnouncementStudentNotifier notifier = mock(AnnouncementStudentNotifier.class);
        ScheduledAnnouncementNotifyJob job = new ScheduledAnnouncementNotifyJob(announcements, notifier);
        when(announcements.findDueForNotification(any(), anyInt()))
                .thenReturn(List.of(announcement(NOW.minusSeconds(60))));
        when(notifier.notifyAfterPublication("notice-1")).thenThrow(new RuntimeException("inbox down"));

        job.refireDueAnnouncements();

        verify(notifier).notifyAfterPublication("notice-1");
        verify(announcements, never()).clearNotifiedAt(any(), any());
    }

    @Test
    void notifierClaimsBeforeReadingFreshAudienceAndSkipsLostClaim() {
        AnnouncementWriteRepository announcements = mock(AnnouncementWriteRepository.class);
        var people = mock(io.campuscore.restfulapi.people.service.PeopleReadService.class);
        var notifications = mock(io.campuscore.restfulapi.notification.repository.NotificationWriteRepository.class);
        var notifier = new AnnouncementStudentNotifier(people, notifications, announcements);
        when(announcements.markNotified(eq("notice-1"), any())).thenReturn(0);
        org.junit.jupiter.api.Assertions.assertEquals(0, notifier.notifyAfterPublication("notice-1"));
        verify(announcements, never()).findById(any());
        when(announcements.markNotified(eq("notice-1"), any())).thenReturn(1);
        when(announcements.findById("notice-1")).thenReturn(Optional.of(announcement(null)));
        when(people.findAnnouncementStudentUserIds(List.of(1), null, List.of("STUDENT"), null)).thenReturn(List.of("current-student"));
        notifier.notifyAfterPublication("notice-1");
        verify(people).findAnnouncementStudentUserIds(List.of(1), null, List.of("STUDENT"), null);
        verify(notifications).createBatch(any());
    }

    private static AnnouncementWriteService service(
            AnnouncementWriteRepository announcements, AnnouncementStudentNotifier notifier) throws Exception {
        ObjectMapper mapper = mock(ObjectMapper.class);
        when(mapper.writeValueAsString(any())).thenReturn("{}");
        return new AnnouncementWriteService(
                announcements, mock(AnnouncementAuditRepository.class), notifier, mapper);
    }

    private static CreateAnnouncementRequest createRequest(Instant publishAt) {
        return new CreateAnnouncementRequest(
                "Notice", "<p>Body</p>", "NORMAL", List.of("STUDENT"), List.of(), false,
                publishAt, null, null, null, null);
    }

    private static AnnouncementResponse announcement(Instant publishAt) {
        return new AnnouncementResponse(
                "notice-1", "Title", "Content", "NORMAL",
                List.of("STUDENT"), List.of(1), false,
                publishAt, null, "publisher-1",
                null, null, null, null, null, null, null, null,
                NOW, NOW, 0, null, null,
                "PUBLISHED", "publisher-1", "reviewer-1", NOW, null, 1,
                null, null, null);
    }

    private static AnnouncementResponse draft() {
        return new AnnouncementResponse(
                "notice-1", "Title", "Content", "NORMAL",
                List.of("STUDENT"), List.of(1), false,
                null, null, "publisher-1",
                null, null, null, null, null, null, null, null,
                NOW, NOW, 0, null, null,
                "DRAFT", "publisher-1", null, null, null, null,
                null, null, null);
    }

    private static AnnouncementResponse inReview() {
        return new AnnouncementResponse(
                "notice-1", "Title", "Content", "NORMAL",
                List.of("STUDENT"), List.of(1), false,
                null, null, "publisher-1",
                null, null, null, null, null, null, null, null,
                NOW, NOW, 0, null, null,
                "IN_REVIEW", "admin-1", null, null, null, null,
                null, null, null);
    }
}
