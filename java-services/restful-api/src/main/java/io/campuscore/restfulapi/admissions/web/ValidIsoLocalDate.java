package io.campuscore.restfulapi.admissions.web;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;
import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/** Validates an optional ISO-8601 calendar date without changing its JSON string contract. */
@Documented
@Constraint(validatedBy = IsoLocalDateValidator.class)
@Target({ElementType.FIELD, ElementType.PARAMETER, ElementType.ANNOTATION_TYPE,
        ElementType.RECORD_COMPONENT})
@Retention(RetentionPolicy.RUNTIME)
public @interface ValidIsoLocalDate {
    String message() default "must be a valid ISO local date";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
