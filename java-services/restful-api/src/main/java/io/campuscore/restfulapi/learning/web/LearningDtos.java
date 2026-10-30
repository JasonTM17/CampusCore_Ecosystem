package io.campuscore.restfulapi.learning.web;

import java.time.Instant;
import java.util.List;

/**
 * P09 LMS DTOs (domain-contracts §6). Authority: the section's assigned
 * lecturer for staff ops; the caller's active enrollment for student ops.
 */
public final class LearningDtos {

    private LearningDtos() {
    }

    public record MaterialResponse(
            String id, String sectionId, String title, String description,
            String fileName, String contentType, Long sizeBytes, String checksum,
            Integer version, Instant createdAt, Instant updatedAt) {
    }

    public record MaterialUpsertRequest(
            String title, String description, Integer version,
            String fileName, String contentType, String contentBase64, String checksum) {
    }

    public record AssignmentResponse(
            String id, String sectionId, String title, String description,
            Instant deadlineAt, Double maxScore, String status,
            Integer version, Instant createdAt, Instant updatedAt,
            String mySubmissionId, String mySubmissionStatus) {
    }

    public record AssignmentUpsertRequest(
            String title, String description, Instant deadlineAt,
            Double maxScore, Integer version) {
    }

    public record SubmissionResponse(
            String id, String assignmentId, String studentId, String status,
            String currentRevisionId, Instant submittedAt, Instant returnedAt,
            Instant reviewedAt, Integer version,
            String studentName, String studentEmail) {
    }

    public record SubmissionRevisionResponse(
            String id, String submissionId, Integer revisionNo,
            String fileName, String contentType, Long sizeBytes,
            String checksum, String textBody, Instant submittedAt) {
    }

    public record FeedbackResponse(
            String id, String submissionId, String revisionId,
            String authorId, String comment, Double score, Instant createdAt) {
    }

    /** Draft save and resubmit payload: text and file are both optional; the
     * file fields travel together so a checksum always binds to real bytes. */
    public record SubmissionUpsertRequest(
            String textBody, String fileName, String contentType,
            String contentBase64, String checksum) {
    }

    public record ReturnRequest(String comment, Double score, Integer expectedVersion) {
    }

    // Named SubmissionReviewRequest so the springdoc components map does not
    // collide with academic CreditLimitApplicationDtos.ReviewRequest.
    public record SubmissionReviewRequest(String comment, Double score, Integer expectedVersion) {
    }

    public record RosterRowResponse(
            String enrollmentId, String studentId, String studentName, String studentEmail,
            String enrollmentStatus, String submissionId, String submissionStatus,
            Instant submittedAt) {
    }
}
