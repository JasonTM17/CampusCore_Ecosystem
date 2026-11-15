package io.campuscore.bursarapi.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDate;

@Entity
@Table(name = "fee_rate", schema = "bursar")
public class FeeRate {

    @Id
    @Column(name = "id")
    private String id;

    /** Academic year label, e.g. "2025-2026". */
    @Column(name = "academic_year", nullable = false)
    private String academicYear;

    /** Department/faculty code; null means the institution-wide default rate. */
    @Column(name = "department_code")
    private String departmentCode;

    /** VND per credit. */
    @Column(name = "price_per_credit", nullable = false)
    private long pricePerCredit;

    @Column(name = "effective_from")
    private LocalDate effectiveFrom;

    protected FeeRate() {
    }

    public String getId() {
        return id;
    }

    public String getAcademicYear() {
        return academicYear;
    }

    public String getDepartmentCode() {
        return departmentCode;
    }

    public long getPricePerCredit() {
        return pricePerCredit;
    }

    public LocalDate getEffectiveFrom() {
        return effectiveFrom;
    }
}
