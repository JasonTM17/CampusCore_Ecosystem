package io.campuscore.restfulapi.mail;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import io.campuscore.restfulapi.mail.config.MailConfig;
import io.campuscore.restfulapi.mail.service.EmailServiceImpl;
import io.campuscore.restfulapi.mail.web.MailDtos.CourseItem;
import io.campuscore.restfulapi.mail.web.MailDtos.CourseRegistrationRequest;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Properties;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import jakarta.mail.Session;
import jakarta.mail.Multipart;
import jakarta.mail.Part;
import jakarta.mail.internet.MimeMessage;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mail.javamail.JavaMailSender;
import org.thymeleaf.spring6.SpringTemplateEngine;
import org.thymeleaf.templatemode.TemplateMode;
import org.thymeleaf.templateresolver.ClassLoaderTemplateResolver;

class EmailServiceTimezoneTest {

    private static final ZoneId CAMPUS_ZONE = ZoneId.of("Asia/Ho_Chi_Minh");
    private static final DateTimeFormatter TIMESTAMP_FORMAT = DateTimeFormatter.ofPattern("HH:mm:ss dd/MM/yyyy");
    private static final Pattern DISPLAY_TIMESTAMP = Pattern.compile("\\d{2}:\\d{2}:\\d{2} \\d{2}/\\d{2}/\\d{4}");

    @Test
    void registrationTimestampUsesCampusZoneWhenJvmUsesUtc() throws Exception {
        TimeZone previousZone = TimeZone.getDefault();
        try {
            TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
            assertEquals("UTC", ZoneId.systemDefault().getId());

            JavaMailSender sender = mock(JavaMailSender.class);
            when(sender.createMimeMessage())
                    .thenReturn(new MimeMessage(Session.getInstance(new Properties())));
            ClassLoaderTemplateResolver resolver = new ClassLoaderTemplateResolver();
            resolver.setPrefix("templates/");
            resolver.setSuffix(".html");
            resolver.setTemplateMode(TemplateMode.HTML);
            resolver.setCharacterEncoding("UTF-8");
            resolver.setCacheable(false);
            SpringTemplateEngine templateEngine = new SpringTemplateEngine();
            templateEngine.setTemplateResolver(resolver);
            MailConfig config = new MailConfig();
            config.setEnabled(true);
            EmailServiceImpl emailService = new EmailServiceImpl(sender, templateEngine, config);

            Instant before = Instant.now();
            emailService.sendCourseRegistration(new CourseRegistrationRequest(
                    "student@example.com", "Student", "S001", null, "HK1",
                    List.of(new CourseItem("C001", "Course", 3, null, null)), 3));
            Instant after = Instant.now();

            ArgumentCaptor<MimeMessage> messageCaptor = ArgumentCaptor.forClass(MimeMessage.class);
            verify(sender).send(messageCaptor.capture());
            String content = readContent(messageCaptor.getValue());
            Matcher timestampMatcher = DISPLAY_TIMESTAMP.matcher(content);
            boolean hasCampusInstant = false;
            while (timestampMatcher.find()) {
                Instant displayedInstant = LocalDateTime.parse(timestampMatcher.group(), TIMESTAMP_FORMAT)
                        .atZone(CAMPUS_ZONE)
                        .toInstant();
                if (!displayedInstant.isBefore(before.minusSeconds(2))
                        && !displayedInstant.isAfter(after.plusSeconds(2))) {
                    hasCampusInstant = true;
                    break;
                }
            }

            assertTrue(hasCampusInstant,
                    "display timestamp must represent the send instant in the campus zone");
        } finally {
            TimeZone.setDefault(previousZone);
        }
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
