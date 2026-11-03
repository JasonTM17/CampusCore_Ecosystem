package io.campuscore.restfulapi.admissions.web;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;

final class IsoLocalDateValidator implements ConstraintValidator<ValidIsoLocalDate, String> {
    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null || value.isBlank()) {
            return true;
        }
        try {
            LocalDate date = LocalDate.parse(value);
            return !date.isAfter(LocalDate.now(ZoneId.of("Asia/Ho_Chi_Minh")));
        } catch (DateTimeParseException exception) {
            return false;
        }
    }
}
