package io.campuscore.bursarapi.model;

import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OneToMany;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "invoice", schema = "bursar")
public class Invoice {

    public static final String STATUS_ISSUED = "ISSUED";
    public static final String STATUS_PARTIAL = "PARTIAL";
    public static final String STATUS_PAID = "PAID";
    public static final String STATUS_CANCELLED = "CANCELLED";

    @Id
    @Column(name = "id")
    private String id;

    @Column(name = "student_id", nullable = false)
    private String studentId;

    /** Term label, e.g. "HK1-2025-2026". */
    @Column(name = "term", nullable = false)
    private String term;

    @Column(name = "status", nullable = false)
    private String status = STATUS_ISSUED;

    @Column(name = "total", nullable = false)
    private long total;

    @Column(name = "issued_at", nullable = false)
    private Instant issuedAt = Instant.now();

    @Column(name = "due_at")
    private Instant dueAt;

    @Column(name = "paid_at")
    private Instant paidAt;

    // Invoice items are small (a handful per term bill); eager fetch keeps the
    // REST DTO path free of lazy-session concerns. Unidirectional join-column
    // mapping — the parent's invoice_id column owns the association.
    @OneToMany(cascade = CascadeType.ALL, fetch = FetchType.EAGER)
    @JoinColumn(name = "invoice_id")
    private List<InvoiceItem> items = new ArrayList<>();

    protected Invoice() {
    }

    public Invoice(String id, String studentId, String term, long total) {
        this.id = id;
        this.studentId = studentId;
        this.term = term;
        this.total = total;
    }

    public String getId() {
        return id;
    }

    public String getStudentId() {
        return studentId;
    }

    public String getTerm() {
        return term;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public long getTotal() {
        return total;
    }

    public Instant getIssuedAt() {
        return issuedAt;
    }

    public Instant getDueAt() {
        return dueAt;
    }

    public void setDueAt(Instant dueAt) {
        this.dueAt = dueAt;
    }

    public Instant getPaidAt() {
        return paidAt;
    }

    public void setPaidAt(Instant paidAt) {
        this.paidAt = paidAt;
    }

    public List<InvoiceItem> getItems() {
        return items;
    }
}
