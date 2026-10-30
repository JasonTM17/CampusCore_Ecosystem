package io.campuscore.restfulapi.admissions.web;

import java.time.Instant;
import java.util.List;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** P10 admissions contracts (domain-contracts §7). */
public final class AdmissionDtos {

    private AdmissionDtos() {
    }

    // ------------------------------------------------------------------
    // Requests
    // ------------------------------------------------------------------

    public record CreateApplicationRequest(@NotBlank @Size(max = 60) String cycle) {
    }

    /** Draft form fields; expectedVersion drives optimistic conflict. */
    public record SaveApplicationRequest(
            @Size(max = 240)
            String fullName,
            @Size(max = 20) @ValidIsoLocalDate
            String dateOfBirth,
            @Size(max = 300)
            String schoolName,
            @Size(max = 200)
            String intendedMajor,
            String essay,
            Integer expectedVersion) {
    }

    /** Checksum-bound upload; bytes travel base64 like learning files. When
     * {@code checksum} is supplied it must equal the sha256 of the decoded
     * bytes or the upload is rejected (FILE_CHECKSUM_MISMATCH). */
    public record AttachmentUploadRequest(
            String fileName,
            String contentType,
            String dataBase64,
            String checksum) {
    }

    public record TransitionRequest(Integer expectedVersion) {
    }

    /** result: PASS | FAIL | NOTE — the checklist row survives every transition. */
    public record ChecklistItemRequest(String item, String result, String note) {
    }

    public record ReturnApplicationRequest(
            List<ChecklistItemRequest> checklist,
            String note,
            Integer expectedVersion) {
    }

    public record DecisionRequest(
            String decision,
            String note,
            List<ChecklistItemRequest> checklist,
            Integer expectedVersion) {
    }

    // ------------------------------------------------------------------
    // Responses
    // ------------------------------------------------------------------

    public record AttachmentResponse(
            String id,
            String fileName,
            String contentType,
            Long sizeBytes,
            String checksum,
            Instant createdAt) {
    }

    /** Append-only review history row (ADM-T03). */
    public record ReviewResponse(
            String id,
            String reviewerId,
            String action,
            String checklist,
            String note,
            String decision,
            Instant createdAt) {
    }

    public record ApplicationResponse(
            String id,
            String applicantUserId,
            String applicantEmail,
            String cycle,
            String status,
            String fullName,
            String dateOfBirth,
            String schoolName,
            String intendedMajor,
            String essay,
            String claimedBy,
            Instant submittedAt,
            String decision,
            String decisionLabel,
            Instant decisionAt,
            Integer version,
            Instant createdAt,
            Instant updatedAt,
            List<AttachmentResponse> attachments,
            List<ReviewResponse> reviews) {
    }

    public record StaffGrantResponse(
            String id,
            String userId,
            String scope,
            String grantedBy,
            Instant createdAt) {
    }
}
