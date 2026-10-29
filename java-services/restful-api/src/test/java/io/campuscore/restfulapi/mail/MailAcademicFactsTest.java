package io.campuscore.restfulapi.mail;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import io.campuscore.restfulapi.mail.config.MailConfig;
import io.campuscore.restfulapi.mail.service.EmailServiceImpl;
import io.campuscore.restfulapi.mail.web.MailDtos.CourseItem;
import io.campuscore.restfulapi.mail.web.MailDtos.CourseRegistrationRequest;
import io.campuscore.restfulapi.mail.web.MailDtos.GradeAlertRequest;
import jakarta.mail.Session;
import jakarta.mail.Multipart;
import jakarta.mail.Part;
import jakarta.mail.internet.MimeMessage;
import java.util.List;
import java.util.Properties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mail.javamail.JavaMailSender;
import org.thymeleaf.spring6.SpringTemplateEngine;
import org.thymeleaf.templatemode.TemplateMode;
import org.thymeleaf.templateresolver.ClassLoaderTemplateResolver;

class MailAcademicFactsTest {

    private EmailServiceImpl emailService;
    private JavaMailSender mailSender;

    @BeforeEach
    void setUp() throws Exception {
        mailSender = mock(JavaMailSender.class);
        when(mailSender.createMimeMessage())
                .thenAnswer(ignored -> new MimeMessage(Session.getInstance(new Properties())));

        ClassLoaderTemplateResolver resolver = new ClassLoaderTemplateResolver();
        resolver.setPrefix("templates/");
        resolver.setSuffix(".html");
        resolver.setTemplateMode(TemplateMode.HTML);
        resolver.setCharacterEncoding("UTF-8");
        resolver.setCacheable(false);
        SpringTemplateEngine renderer = new SpringTemplateEngine();
        renderer.setTemplateResolver(resolver);

        MailConfig config = new MailConfig();
        config.setEnabled(true);
        emailService = new EmailServiceImpl(mailSender, renderer, config);
    }

    @Test
    void omittedGradeRanksAndSemesterAreShownAsUnavailable() throws Exception {
        emailService.sendGradeAlert(new GradeAlertRequest(
                "student@example.com", "Student", "S001", null,
                1.0, 2.5, null, 40, null, List.of()));

        String html = sentContent();
        assertTrue(html.contains("Chưa được cung cấp"));
        assertFalse(html.contains("XUẤT SẮC"));
        assertTrue(html.contains("40"));
    }

    @Test
    void omittedRegistrationSemesterAndDepartmentAreShownAsUnavailable() throws Exception {
        emailService.sendCourseRegistration(new CourseRegistrationRequest(
                "student@example.com", "Student", "S001", null, null,
                List.of(new CourseItem("C001", "Course", 3, null, null)), 3));

        String html = sentContent();
        assertTrue(html.contains("Chưa được cung cấp"));
        assertFalse(html.contains("Học kỳ 1 Năm học 2026-2027"));
        assertFalse(html.contains("Khoa Công nghệ Thông tin"));
    }

    private String sentContent() throws Exception {
        ArgumentCaptor<MimeMessage> messageCaptor = ArgumentCaptor.forClass(MimeMessage.class);
        verify(mailSender).send(messageCaptor.capture());
        return readContent(messageCaptor.getValue());
    }

    private static String readContent(Part part) throws Exception {
        Object content = part.getContent();
        if (content instanceof Multipart multipart) {
            StringBuilder text = new StringBuilder();
            for (int i = 0; i < multipart.getCount(); i++) {
                text.append(readContent(multipart.getBodyPart(i))).append('\n');
            }
            return text.toString();
        }
        return content instanceof String text ? text : "";
    }
}
