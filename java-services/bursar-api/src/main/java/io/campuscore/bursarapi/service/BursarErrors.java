package io.campuscore.bursarapi.service;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

@ResponseStatus(HttpStatus.NOT_FOUND)
class BursarNotFoundException extends RuntimeException {
    BursarNotFoundException(String message) {
        super(message);
    }
}

@ResponseStatus(HttpStatus.CONFLICT)
class BursarConflictException extends RuntimeException {
    BursarConflictException(String message) {
        super(message);
    }
}

@ResponseStatus(HttpStatus.BAD_REQUEST)
class BursarValidationException extends RuntimeException {
    BursarValidationException(String message) {
        super(message);
    }
}
