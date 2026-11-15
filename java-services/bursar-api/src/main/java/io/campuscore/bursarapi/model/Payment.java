package io.campuscore.bursarapi.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "payment", schema = "bursar")
public class Payment {

    public static final String STATUS_COMPLETED = "COMPLETED";
    public static final String STATUS_FAILED = "FAILED";

    @Id
    @Column(name = "id")
    private String id;

    @Column(name = "invoice_id", nullable = false)
    private String invoiceId;

    /** Client-supplied Idempotency-Key; unique so retries cannot double-charge. */
    @Column(name = "idempotency_key", unique = true)
    private String idempotencyKey;

    @Column(name = "amount", nullable = false)
    private long amount;

    @Column(name = "method", nullable = false)
    private String method;

    @Column(name = "reference")
    private String reference;

    @Column(name = "status", nullable = false)
    private String status = STATUS_COMPLETED;

    @Column(name = "paid_at", nullable = false)
    private Instant paidAt = Instant.now();

    protected Payment() {
    }

    public Payment(String id, String invoiceId, String idempotencyKey,
            long amount, String method, String reference) {
        this.id = id;
        this.invoiceId = invoiceId;
        this.idempotencyKey = idempotencyKey;
        this.amount = amount;
        this.method = method;
        this.reference = reference;
    }

    public String getId() {
        return id;
    }

    public String getInvoiceId() {
        return invoiceId;
    }

    public String getIdempotencyKey() {
        return idempotencyKey;
    }

    public long getAmount() {
        return amount;
    }

    public String getMethod() {
        return method;
    }

    public String getReference() {
        return reference;
    }

    public String getStatus() {
        return status;
    }

    public Instant getPaidAt() {
        return paidAt;
    }
}
