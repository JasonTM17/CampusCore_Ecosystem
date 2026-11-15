package io.campuscore.bursarapi.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/**
 * A financial hold placed on a student — the bursar-office mechanism real
 * universities use to block registration while tuition is outstanding.
 */
@Entity
@Table(name = "financial_hold", schema = "bursar")
public class FinancialHold {

    public static final String STATUS_ACTIVE = "ACTIVE";
    public static final String STATUS_RELEASED = "RELEASED";

    @Id
    @Column(name = "id")
    private String id;

    @Column(name = "student_id", nullable = false)
    private String studentId;

    @Column(name = "reason", nullable = false)
    private String reason;

    @Column(name = "status", nullable = false)
    private String status = STATUS_ACTIVE;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "released_at")
    private Instant releasedAt;

    protected FinancialHold() {
    }

    public FinancialHold(String id, String studentId, String reason) {
        this.id = id;
        this.studentId = studentId;
        this.reason = reason;
    }

    public String getId() {
        return id;
    }

    public String getStudentId() {
        return studentId;
    }

    public String getReason() {
        return reason;
    }

    public String getStatus() {
        return status;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getReleasedAt() {
        return releasedAt;
    }

    public void release() {
        this.status = STATUS_RELEASED;
        this.releasedAt = Instant.now();
    }
}
