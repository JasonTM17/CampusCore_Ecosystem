package io.campuscore.restfulapi.security;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Declares an existing authorization check in a handler or downstream service.
 * This documentation marker grants no access and installs no security interceptor.
 * Name the enforcing code and its caller/ownership rule; never use it to exempt
 * a route whose only policy is the global authenticated fallback.
 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.TYPE, ElementType.METHOD})
public @interface ServiceEnforced {
    String value();
}
