package io.campuscore.restfulapi.careers.web;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.List;
import jakarta.validation.constraints.Size;

/** DTO records for the P12 careers/applications surface (contract §9). */
public final class CareerDtos {

    private CareerDtos() {
    }

    // ------------------------------------------------------------------
    // Organizations / opportunities
    // ------------------------------------------------------------------

    public record OrganizationResponse(
            String id,
            String name,
            String description,
            int version) {
    }

    public record OpportunityResponse(
            String id,
            String organizationId,
            String organizationName,
            String title,
            String description,
            String location,
            String employmentType,
            String salaryText,
            String status,
            String submittedBy,
            String reviewedBy,
            Instant reviewedAt,
            Instant publishedAt,
            Instant pausedAt,
            Instant closedAt,
            String moderationReason,
            int version,
            Instant createdAt) {
    }

    public record CreateOpportunityRequest(
            @Size(max = 120)
            String organizationId,
            @Size(max = 300)
            String title,
            String description,
            @Size(max = 200)
            String location,
            @Size(max = 60)
            String employmentType,
            @Size(max = 200)
            String salaryText) {
    }

    @Schema(name = "CareerTransitionRequest")
    public record TransitionRequest(Integer expectedVersion, String reason) {
    }

    public record ApplicationTransitionRequest(String toStatus, Integer expectedVersion) {
    }

    // ------------------------------------------------------------------
    // Applications
    // ------------------------------------------------------------------

    @Schema(name = "CareerApplicationResponse")
    public record ApplicationResponse(
            String id,
            String opportunityId,
            String opportunityTitle,
            String organizationId,
            String organizationName,
            String candidateUserId,
            String candidateEmail,
            String status,
            String coverLetter,
            Instant submittedAt,
            String statusChangedBy,
            Instant statusChangedAt,
            String moderationReason,
            int version,
            Instant createdAt,
            List<AttachmentResponse> attachments) {
    }

    public record ApplyRequest(String opportunityId, String coverLetter) {
    }

    public record AttachmentResponse(
            String id,
            String fileName,
            String contentType,
            String checksum,
            Instant createdAt) {
    }

    public record AttachmentUploadRequest(
            String fileName,
            String contentType,
            String dataBase64,
            String checksum) {
    }

    // ------------------------------------------------------------------
    // Grants
    // ------------------------------------------------------------------

    @Schema(name = "CareerStaffGrantResponse")
    public record StaffGrantResponse(
            String id,
            String userId,
            String scope,
            String organizationId,
            String grantedBy,
            Instant createdAt) {
    }

    public record GrantRequest(String userId, String organizationId) {
    }
}
