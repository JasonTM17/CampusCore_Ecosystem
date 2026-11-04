package io.campuscore.restfulapi.learning.web;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
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
            @NotBlank(message = "title is required")
            @Size(max = 300, message = "title must be at most 300 characters") String title,
            String description, Integer version,
            @Size(max = 300, message = "fileName must be at most 300 characters") String fileName,
            @Size(max = 120, message = "contentType must be at most 120 characters") String contentType,
            String contentBase64,
            @Size(max = 128, message = "checksum must be at most 128 characters") String checksum) {
    }

    public record AssignmentResponse(
            String id, String sectionId, String title, String description,
            Instant deadlineAt, Double maxScore, String status,
            Integer version, Instant createdAt, Instant updatedAt,
            String mySubmissionId, String mySubmissionStatus) {
    }

    public record AssignmentUpsertRequest(
            @NotBlank(message = "title is required")
            @Size(max = 300, message = "title must be at most 300 characters") String title,
            String description, Instant deadlineAt,
            @DecimalMin(value = "0.0", message = "maxScore must be zero or positive")
            @Digits(integer = 4, fraction = 2, message = "maxScore must fit NUMERIC(6,2)") Double maxScore,
            Integer version) {
    }

    /** Draft fields are the owning student's working copy; staff views leave
     * them null. The storage key is deliberately absent from the contract. */
    public record SubmissionResponse(
            String id, String assignmentId, String studentId, String status,
            String currentRevisionId, Instant submittedAt, Instant returnedAt,
            Instant reviewedAt, Integer version,
            String studentName, String studentEmail,
            String draftText, String draftFileName, String draftContentType,
            Long draftSizeBytes) {
    }

    public record SubmissionRevisionResponse(
            String id, String submissionId, Integer revisionNo,
            String fileName, String contentType, Long sizeBytes,
            String checksum, String textBody, Instant submittedAt) {
    }

    @Schema(name = "LearningFeedbackResponse")
    public record FeedbackResponse(
            String id, String submissionId, String revisionId,
            String authorId, String comment, Double score, Instant createdAt) {
    }

    /** Draft save and resubmit payload: text and file are both optional; the
     * file fields travel together so a checksum always binds to real bytes. */
    public record SubmissionUpsertRequest(
            String textBody,
            @Size(max = 300, message = "fileName must be at most 300 characters") String fileName,
            @Size(max = 120, message = "contentType must be at most 120 characters") String contentType,
            String contentBase64,
            @Size(max = 128, message = "checksum must be at most 128 characters") String checksum) {
    }

    public record ReturnRequest(
            String comment,
            @DecimalMin(value = "0.0", message = "score must be zero or positive")
            @Digits(integer = 4, fraction = 2, message = "score must fit NUMERIC(6,2)") Double score,
            Integer expectedVersion) {
    }

    // Named SubmissionReviewRequest so the springdoc components map does not
    // collide with academic CreditLimitApplicationDtos.ReviewRequest.
    public record SubmissionReviewRequest(
            String comment,
            @DecimalMin(value = "0.0", message = "score must be zero or positive")
            @Digits(integer = 4, fraction = 2, message = "score must fit NUMERIC(6,2)") Double score,
            Integer expectedVersion) {
    }

    public record RosterRowResponse(
            String enrollmentId, String studentId, String studentName, String studentEmail,
            String enrollmentStatus, String submissionId, String submissionStatus,
            Instant submittedAt) {
    }
}
