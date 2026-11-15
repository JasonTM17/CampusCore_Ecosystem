package io.campuscore.bursarapi.web;

import io.campuscore.bursarapi.model.FinancialHold;
import io.campuscore.bursarapi.model.Invoice;
import io.campuscore.bursarapi.model.InvoiceItem;
import io.campuscore.bursarapi.model.Payment;
import io.campuscore.bursarapi.model.StudentAccount;
import io.campuscore.bursarapi.service.BursarService;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/me/bursar")
@Validated
public class MeBursarController {

    private final BursarService bursar;

    public MeBursarController(BursarService bursar) {
        this.bursar = bursar;
    }

    /** Access-token claim carrying the academic student id (set by the SIS issuer). */
    private static String studentIdOf(Jwt jwt) {
        String studentId = jwt.getClaimAsString("studentId");
        if (studentId == null || studentId.isBlank()) {
            throw new BursarForbiddenException("token carries no studentId claim");
        }
        return studentId;
    }

    @GetMapping("/account")
    public Map<String, Object> account(@AuthenticationPrincipal Jwt jwt) {
        String studentId = studentIdOf(jwt);
        StudentAccount account = bursar.accountFor(studentId);
        return Map.of(
                "studentId", account.getStudentId(),
                "balance", account.getBalance(),
                "currency", account.getCurrency(),
                "holds", bursar.activeHoldsFor(studentId).stream().map(MeBursarController::holdDto).toList());
    }

    @GetMapping("/invoices")
    public List<Map<String, Object>> invoices(@AuthenticationPrincipal Jwt jwt) {
        String studentId = studentIdOf(jwt);
        return bursar.invoicesFor(studentId).stream()
                .map(i -> invoiceDto(i, i.getItems(), bursar.paidAmountFor(i.getId()))).toList();
    }

    @GetMapping("/invoices/{invoiceId}")
    public Map<String, Object> invoice(@AuthenticationPrincipal Jwt jwt,
            @PathVariable String invoiceId) {
        Invoice invoice = bursar.invoiceFor(studentIdOf(jwt), invoiceId);
        return invoiceDto(invoice, invoice.getItems(), bursar.paidAmountFor(invoice.getId()));
    }

    @GetMapping("/holds")
    public List<Map<String, Object>> holds(@AuthenticationPrincipal Jwt jwt) {
        return bursar.activeHoldsFor(studentIdOf(jwt)).stream()
                .map(MeBursarController::holdDto).toList();
    }

    @PostMapping("/invoices/{invoiceId}/payments")
    public ResponseEntity<Map<String, Object>> pay(@AuthenticationPrincipal Jwt jwt,
            @PathVariable String invoiceId,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey,
            @RequestBody @Validated PaymentRequest body) {
        Payment payment = bursar.pay(studentIdOf(jwt), invoiceId, idempotencyKey,
                body.amount(), body.method(), body.reference());
        return ResponseEntity.ok(Map.of(
                "id", payment.getId(),
                "invoiceId", payment.getInvoiceId(),
                "amount", payment.getAmount(),
                "method", payment.getMethod(),
                "reference", payment.getReference() == null ? "" : payment.getReference(),
                "status", payment.getStatus(),
                "paidAt", payment.getPaidAt().toString()));
    }

    static Map<String, Object> invoiceDto(Invoice invoice, List<InvoiceItem> items, long paidAmount) {
        var itemDtos = (items == null ? List.<InvoiceItem>of() : items).stream()
                .map(it -> Map.<String, Object>of(
                        "id", it.getId(),
                        "label", it.getLabel(),
                        "courseCode", it.getCourseCode() == null ? "" : it.getCourseCode(),
                        "credits", it.getCredits(),
                        "unitPrice", it.getUnitPrice(),
                        "amount", it.getAmount()))
                .toList();
        java.util.Map<String, Object> dto = new java.util.LinkedHashMap<>();
        dto.put("id", invoice.getId());
        dto.put("studentId", invoice.getStudentId());
        dto.put("term", invoice.getTerm());
        dto.put("status", invoice.getStatus());
        dto.put("total", invoice.getTotal());
        dto.put("paidAmount", paidAmount);
        dto.put("remaining", Math.max(0, invoice.getTotal() - paidAmount));
        dto.put("issuedAt", invoice.getIssuedAt().toString());
        dto.put("dueAt", invoice.getDueAt() == null ? "" : invoice.getDueAt().toString());
        dto.put("paidAt", invoice.getPaidAt() == null ? "" : invoice.getPaidAt().toString());
        dto.put("items", itemDtos);
        return dto;
    }

    static Map<String, Object> holdDto(FinancialHold hold) {
        return Map.of(
                "id", hold.getId(),
                "reason", hold.getReason(),
                "status", hold.getStatus(),
                "createdAt", hold.getCreatedAt().toString());
    }

    public record PaymentRequest(
            @Min(1) @Max(100_000_000L) long amount,
            @NotBlank String method,
            String reference) {
    }

    @org.springframework.web.bind.annotation.ResponseStatus(
            org.springframework.http.HttpStatus.FORBIDDEN)
    static class BursarForbiddenException extends RuntimeException {
        BursarForbiddenException(String message) {
            super(message);
        }
    }
}
