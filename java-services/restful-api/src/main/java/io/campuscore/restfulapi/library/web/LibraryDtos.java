package io.campuscore.restfulapi.library.web;

import java.time.Instant;
import java.util.List;

/** DTO records for the P11 library circulation surface (contract §8). */
public final class LibraryDtos {

    private LibraryDtos() {
    }

    // ------------------------------------------------------------------
    // Catalogue
    // ------------------------------------------------------------------

    public record TitleResponse(
            String id,
            String title,
            String author,
            String isbn,
            String category,
            String publisher,
            Integer publishedYear,
            String description,
            int totalCopies,
            int availableCopies,
            int version,
            List<CopyResponse> copies) {
    }

    public record CopyResponse(
            String id,
            String titleId,
            String barcode,
            String status,
            int version) {
    }

    public record CreateTitleRequest(
            String title,
            String author,
            String isbn,
            String category,
            String publisher,
            Integer publishedYear,
            String description) {
    }

    public record CreateCopyRequest(
            String titleId,
            String barcode) {
    }

    // ------------------------------------------------------------------
    // Loan requests
    // ------------------------------------------------------------------

    public record LoanRequestResponse(
            String id,
            String copyId,
            String barcode,
            String titleId,
            String title,
            String borrowerUserId,
            String borrowerEmail,
            String status,
            Instant requestedAt,
            Instant expiresAt,
            String approvedBy,
            Instant approvedAt,
            String issuedBy,
            Instant issuedAt,
            Instant dueAt,
            String returnedBy,
            Instant returnedAt,
            String cancelledBy,
            Instant cancelledAt,
            String cancelReason,
            int version,
            Instant createdAt) {
    }

    public record BorrowRequest(String copyId) {
    }

    public record TransitionRequest(Integer expectedVersion) {
    }

    public record IssueRequest(Integer expectedVersion, Integer dueDays) {
    }

    public record CancelRequest(Integer expectedVersion, String reason) {
    }

    // ------------------------------------------------------------------
    // Grants
    // ------------------------------------------------------------------

    public record StaffGrantResponse(
            String id,
            String userId,
            String scope,
            String grantedBy,
            Instant createdAt) {
    }
}
