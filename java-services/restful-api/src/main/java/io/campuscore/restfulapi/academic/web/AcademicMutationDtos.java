package io.campuscore.restfulapi.academic.web;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.List;

public final class AcademicMutationDtos {

    private AcademicMutationDtos() {
    }

    public record EnrollRequest(@NotBlank String sectionId) {
    }

    public record GradeUpdateRequest(@NotEmpty List<@Valid GradeUpdate> grades) {
    }

    /**
     * Both scores null clears the saved draft grade (a mistaken entry must be
     * removable); one null + one value is rejected in the service because a
     * half score cannot produce a final mark.
     */
    public record GradeUpdate(
            @NotBlank String enrollmentId,
            @DecimalMin("0.0") @DecimalMax("10.0") BigDecimal processScore,
            @DecimalMin("0.0") @DecimalMax("10.0") BigDecimal finalExamScore,
            @Min(0) Integer version) {

        /** Compatibility for callers that have not adopted the optional version yet. */
        public GradeUpdate(String enrollmentId, BigDecimal processScore, BigDecimal finalExamScore) {
            this(enrollmentId, processScore, finalExamScore, null);
        }
    }
}
