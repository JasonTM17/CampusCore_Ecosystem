package io.campuscore.restfulapi.mail;

import static org.junit.jupiter.api.Assertions.assertAll;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import io.campuscore.restfulapi.mail.config.MailConfig;
import io.campuscore.restfulapi.mail.repository.MailRecipientScopeRepository;
import io.campuscore.restfulapi.mail.service.EmailService;
import io.campuscore.restfulapi.mail.service.EmailServiceImpl;
import io.campuscore.restfulapi.mail.web.MailController;
import io.campuscore.restfulapi.mail.web.MailDtos.AcademicNoticeRequest;
import io.campuscore.restfulapi.mail.web.MailDtos.CourseItem;
import io.campuscore.restfulapi.mail.web.MailDtos.CourseRegistrationRequest;
import io.campuscore.restfulapi.mail.web.MailDtos.GradeAlertRequest;
import io.campuscore.restfulapi.mail.web.MailDtos.MailDispatchResponse;
import io.campuscore.restfulapi.mail.web.MailDtos.TestEmailRequest;
import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;
import java.util.List;
import java.util.Properties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mail.MailSendException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.security.oauth2.jwt.Jwt;
import org.thymeleaf.spring6.SpringTemplateEngine;
import org.thymeleaf.templatemode.TemplateMode;
import org.thymeleaf.templateresolver.ClassLoaderTemplateResolver;

class MailControllerDisabledDeliveryTest {

    private JavaMailSender mailSender;
    private MailController disabledController;

    @BeforeEach
    void setUp() throws Exception {
        mailSender = mock(JavaMailSender.class);
        when(mailSender.createMimeMessage())
                .thenReturn(new MimeMessage(Session.getInstance(new Properties())));
        disabledController = controller(false, mailSender);
    }

    @Test
    void disabledRoutesReturnTheExistingNotDeliveredResult() {
        Jwt admin = adminJwt();
        assertAll(
                () -> assertNotDelivered(disabledController.sendTestEmail(
                        new TestEmailRequest("student@example.com", "Student", null))),
                () -> assertNotDelivered(disabledController.sendNotice(admin, new AcademicNoticeRequest(
                        "student@example.com", "Student", null, "Notice", "Office", "Body",
                        List.of(), null, null))),
                () -> assertNotDelivered(disabledController.sendRegistration(admin, new CourseRegistrationRequest(
                        "student@example.com", "Student", "S001", null, null,
                        List.of(new CourseItem("C001", "Course", 3, null, null)), 3))),
                () -> assertNotDelivered(disabledController.sendGradeAlert(admin, new GradeAlertRequest(
                        "student@example.com", "Student", "S001", null, 1.0, 2.5,
                        null, 40, null, List.of())))
        );

        verify(mailSender, never()).createMimeMessage();
        verify(mailSender, never()).send(any(MimeMessage.class));
    }

    @Test
    void enabledSenderSuccessIsReportedAsDelivered() {
        JavaMailSender enabledSender = mock(JavaMailSender.class);
        when(enabledSender.createMimeMessage())
                .thenReturn(new MimeMessage(Session.getInstance(new Properties())));
        MailController enabledController = controller(true, enabledSender);

        ResponseEntity<MailDispatchResponse> response = enabledController.sendTestEmail(
                new TestEmailRequest("student@example.com", "Student", null));

        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNotNull(response.getBody());
        assertTrue(response.getBody().success());
        verify(enabledSender).send(any(MimeMessage.class));
    }

    @Test
    void enabledSenderFailureDoesNotReturnDeliveredSuccess() {
        JavaMailSender failingSender = mock(JavaMailSender.class);
        when(failingSender.createMimeMessage())
                .thenReturn(new MimeMessage(Session.getInstance(new Properties())));
        doThrow(new MailSendException("synthetic sender failure"))
                .when(failingSender).send(any(MimeMessage.class));
        MailController enabledController = controller(true, failingSender);

        assertThrows(MailSendException.class, () -> enabledController.sendTestEmail(
                new TestEmailRequest("student@example.com", "Student", null)));
    }

    private static void assertNotDelivered(ResponseEntity<MailDispatchResponse> response) {
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNotNull(response.getBody());
        assertFalse(response.getBody().success());
        assertTrue(response.getBody().message().contains("chưa được gửi"));
        assertNull(response.getBody().dispatchedAt());
    }

    private static MailController controller(boolean enabled, JavaMailSender sender) {
        ClassLoaderTemplateResolver resolver = new ClassLoaderTemplateResolver();
        resolver.setPrefix("templates/");
        resolver.setSuffix(".html");
        resolver.setTemplateMode(TemplateMode.HTML);
        resolver.setCharacterEncoding("UTF-8");
        resolver.setCacheable(false);
        SpringTemplateEngine templateEngine = new SpringTemplateEngine();
        templateEngine.setTemplateResolver(resolver);
        MailConfig config = new MailConfig();
        config.setEnabled(enabled);
        EmailService emailService = new EmailServiceImpl(sender, templateEngine, config);
        @SuppressWarnings("unchecked")
        ObjectProvider<MailRecipientScopeRepository> recipientScope = mock(ObjectProvider.class);
        return new MailController(emailService, recipientScope);
    }

    private static Jwt adminJwt() {
        Jwt jwt = mock(Jwt.class);
        when(jwt.getClaimAsStringList("roles")).thenReturn(List.of("ADMIN"));
        return jwt;
    }
}
