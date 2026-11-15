package io.campuscore.bursarapi.service;

import io.campuscore.bursarapi.model.FinancialHold;
import io.campuscore.bursarapi.model.Invoice;
import io.campuscore.bursarapi.model.Payment;
import io.campuscore.bursarapi.model.StudentAccount;
import io.campuscore.bursarapi.repo.FinancialHoldRepository;
import io.campuscore.bursarapi.repo.InvoiceRepository;
import io.campuscore.bursarapi.repo.PaymentRepository;
import io.campuscore.bursarapi.repo.StudentAccountRepository;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class BursarService {

    private final StudentAccountRepository accounts;
    private final InvoiceRepository invoices;
    private final PaymentRepository payments;
    private final FinancialHoldRepository holds;

    public BursarService(StudentAccountRepository accounts, InvoiceRepository invoices,
            PaymentRepository payments, FinancialHoldRepository holds) {
        this.accounts = accounts;
        this.invoices = invoices;
        this.payments = payments;
        this.holds = holds;
    }

    @Transactional
    public StudentAccount accountFor(String studentId) {
        return accounts.findByStudentId(studentId)
                .orElseGet(() -> accounts.save(
                        new StudentAccount("acct-" + UUID.randomUUID(), studentId)));
    }

    public List<Invoice> invoicesFor(String studentId) {
        return invoices.findByStudentIdOrderByIssuedAtDesc(studentId);
    }

    public Invoice invoiceFor(String studentId, String invoiceId) {
        return invoices.findByIdAndStudentId(invoiceId, studentId)
                .orElseThrow(() -> new BursarNotFoundException("invoice not found"));
    }

    public List<FinancialHold> activeHoldsFor(String studentId) {
        return holds.findByStudentIdAndStatus(studentId, FinancialHold.STATUS_ACTIVE);
    }

    /**
     * Record a payment against an invoice. Idempotent on the client-supplied key:
     * a replayed request returns the original payment without side effects.
     */
    @Transactional
    public Payment pay(String studentId, String invoiceId, String idempotencyKey,
            long amount, String method, String reference) {
        if (idempotencyKey != null && !idempotencyKey.isBlank()) {
            var existing = payments.findByIdempotencyKey(idempotencyKey);
            if (existing.isPresent()) {
                return existing.get();
            }
        }
        Invoice invoice = invoiceFor(studentId, invoiceId);
        if (Invoice.STATUS_CANCELLED.equals(invoice.getStatus())) {
            throw new BursarConflictException("invoice is cancelled");
        }
        if (Invoice.STATUS_PAID.equals(invoice.getStatus())) {
            throw new BursarConflictException("invoice already paid");
        }
        if (amount <= 0 || amount > invoice.getTotal()) {
            throw new BursarValidationException("amount must be between 1 and the invoice total");
        }

        Payment payment = payments.save(new Payment(
                "pay-" + UUID.randomUUID(), invoiceId,
                (idempotencyKey == null || idempotencyKey.isBlank()) ? null : idempotencyKey,
                amount, method, reference));

        long paidSoFar = payments.findByInvoiceId(invoiceId).stream()
                .filter(p -> Payment.STATUS_COMPLETED.equals(p.getStatus()))
                .mapToLong(Payment::getAmount).sum();
        if (paidSoFar >= invoice.getTotal()) {
            invoice.setStatus(Invoice.STATUS_PAID);
            invoice.setPaidAt(java.time.Instant.now());
        } else {
            invoice.setStatus(Invoice.STATUS_PARTIAL);
        }
        invoices.save(invoice);

        StudentAccount account = accountFor(studentId);
        account.setBalance(Math.max(0, account.getBalance() - amount));
        accounts.save(account);

        if (invoice.getStatus().equals(Invoice.STATUS_PAID)) {
            holds.findByStudentIdAndStatus(studentId, FinancialHold.STATUS_ACTIVE)
                    .forEach(h -> { h.release(); holds.save(h); });
        }
        return payment;
    }
}
