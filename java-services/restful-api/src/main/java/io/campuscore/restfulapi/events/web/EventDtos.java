package io.campuscore.restfulapi.events.web;

import java.time.Instant;
import java.util.List;

/** Request/response records for the events domain (contract D4, phase-08). */
public final class EventDtos {

    private EventDtos() {
    }

    public record CreateEventRequest(
            String title,
            String description,
            String location,
            String organizer,
            Integer capacity,
            Instant startsAt,
            Instant endsAt,
            Instant registrationOpensAt,
            Instant registrationClosesAt) {
    }

    public record UpdateEventRequest(
            String title,
            String description,
            String location,
            String organizer,
            Integer capacity,
            Instant startsAt,
            Instant endsAt,
            Instant registrationOpensAt,
            Instant registrationClosesAt) {
    }

    /** Optional window override; omitted fields keep the stored window. */
    public record OpenRegistrationRequest(
            Instant registrationOpensAt,
            Instant registrationClosesAt) {
    }

    public record CancelEventRequest(String reason) {
    }

    /** One roster mark; status is ATTENDED or ABSENT (manual marking only). */
    public record AttendanceMarkRequest(String registrationId, String status) {
    }

    public record AttendanceBatchRequest(List<AttendanceMarkRequest> marks) {
    }

    public record EventResponse(
            String id,
            String title,
            String description,
            String location,
            String organizer,
            String status,
            int capacity,
            int registeredCount,
            int seatsRemaining,
            Instant startsAt,
            Instant endsAt,
            Instant registrationOpensAt,
            Instant registrationClosesAt,
            String ownerId,
            int version,
            Instant createdAt,
            Instant updatedAt,
            // Caller-scoped fields; null for staff/anonymous readers.
            String myRegistrationId,
            String myRegistrationStatus,
            String myAttendanceStatus) {
    }

    public record RegistrationResponse(
            String id,
            String eventId,
            String studentId,
            String status,
            String attendanceStatus,
            Instant registeredAt,
            Instant cancelledAt) {
    }

    /** Student history row: registration joined with its event summary. */
    public record MyRegistrationResponse(
            String registrationId,
            String registrationStatus,
            String attendanceStatus,
            Instant registeredAt,
            Instant cancelledAt,
            EventResponse event) {
    }

    public record RosterEntry(
            String registrationId,
            String studentId,
            String studentName,
            String email,
            String status,
            String attendanceStatus,
            String attendanceMarkedBy,
            Instant attendanceMarkedAt,
            Instant registeredAt) {
    }

    public record StaffGrantResponse(
            String id,
            String userId,
            String scope,
            String grantedBy,
            Instant createdAt) {
    }
}
