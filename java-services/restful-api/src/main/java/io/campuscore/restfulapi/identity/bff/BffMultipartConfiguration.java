package io.campuscore.restfulapi.identity.bff;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.servlet.autoconfigure.MultipartProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.multipart.MultipartHttpServletRequest;
import org.springframework.web.multipart.MultipartResolver;
import org.springframework.web.multipart.support.StandardServletMultipartResolver;
import org.springframework.web.servlet.DispatcherServlet;

/**
 * Spring MVC resolves multipart requests eagerly before a handler runs, and
 * the parser consumes the request stream while doing it — a proxy handler then
 * forwards an empty upload. Business-proxy paths keep the raw stream so the
 * bytes (and their ceiling) stay in the proxy's hands; every resource-lane
 * route keeps the servlet parser and its configured limits unchanged.
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(prefix = "identity.bff", name = "enabled", havingValue = "true")
class BffMultipartConfiguration {

    @Bean(name = DispatcherServlet.MULTIPART_RESOLVER_BEAN_NAME)
    MultipartResolver multipartResolver(MultipartProperties properties) {
        StandardServletMultipartResolver standard = new StandardServletMultipartResolver();
        standard.setResolveLazily(properties.isResolveLazily());
        standard.setStrictServletCompliance(properties.isStrictServletCompliance());
        return new MultipartResolver() {
            @Override
            public boolean isMultipart(HttpServletRequest request) {
                return !request.getRequestURI().startsWith("/bff/api/")
                        && standard.isMultipart(request);
            }

            @Override
            public MultipartHttpServletRequest resolveMultipart(HttpServletRequest request) {
                return standard.resolveMultipart(request);
            }

            @Override
            public void cleanupMultipart(MultipartHttpServletRequest request) {
                standard.cleanupMultipart(request);
            }
        };
    }
}
