package io.campuscore.bursarapi.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "student_account", schema = "bursar")
public class StudentAccount {

    @Id
    @Column(name = "id")
    private String id;

    /** academic.Student.student_id (logical FK — schema-owned, no cross-schema constraint). */
    @Column(name = "student_id", nullable = false, unique = true)
    private String studentId;

    /** Outstanding balance in VND; positive means the student still owes. */
    @Column(name = "balance", nullable = false)
    private long balance;

    @Column(name = "currency", nullable = false)
    private String currency = "VND";

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    protected StudentAccount() {
    }

    public StudentAccount(String id, String studentId) {
        this.id = id;
        this.studentId = studentId;
        this.balance = 0;
    }

    public String getId() {
        return id;
    }

    public String getStudentId() {
        return studentId;
    }

    public long getBalance() {
        return balance;
    }

    public void setBalance(long balance) {
        this.balance = balance;
        this.updatedAt = Instant.now();
    }

    public String getCurrency() {
        return currency;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
