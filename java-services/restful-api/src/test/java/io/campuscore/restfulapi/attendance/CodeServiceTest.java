package io.campuscore.restfulapi.attendance;

import static org.assertj.core.api.Assertions.*;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import org.junit.jupiter.api.Test;

class CodeServiceTest {
    static AttendanceCheckinProperties properties() {
        var p=new AttendanceCheckinProperties();
        p.setEncryptionKey(Base64.getEncoder().encodeToString(new byte[32]));
        p.setPepper("local-test-pepper-with-at-least-32-characters"); return p;
    }
    private final Instant start=Instant.parse("2026-10-29T03:00:00Z");
    private CodeService at(long seconds) { return new CodeService(Clock.fixed(start.plusSeconds(seconds),ZoneOffset.UTC),properties()); }
    @Test void currentAndPreviousAcceptedButOlderCodeExpires() {
        String secret=at(0).newSecret("session"),code=at(0).current("session",secret);
        assertThat(code).matches("[0-9]{6}");
        assertThat(at(0).accepts("session",secret,code)).isTrue();
        assertThat(at(30).accepts("session",secret,code)).isTrue();
        assertThat(at(60).accepts("session",secret,code)).isFalse();
        assertThat(at(0).expiresAt()).isEqualTo(start.plusSeconds(30));
    }
    @Test void wrongMalformedAndAbsentCodesRefused() {
        String secret=at(0).newSecret("session");
        for(String code:new String[]{null,"wrong","0000000","-12345","１２３４５６"})
            assertThat(at(0).accepts("session",secret,code)).isFalse();
        String right=at(0).current("session",secret);
        String wrong=right.equals("000000")?"000001":"000000";
        assertThat(at(0).accepts("session",secret,wrong)).isFalse();
    }
    @Test void secretsAreRandomEncryptedAndBoundToSession() {
        String a=at(0).newSecret("session"),b=at(0).newSecret("session");
        assertThat(a).isNotEqualTo(b);
        assertThatThrownBy(()->at(0).current("another",a)).isInstanceOf(IllegalStateException.class);
    }
    @Test void missingKeyFailsClosedWithoutSensitiveMessage() {
        assertThatThrownBy(()->new CodeService(Clock.systemUTC(),new AttendanceCheckinProperties()).newSecret("s"))
                .isInstanceOf(io.campuscore.restfulapi.web.DomainException.class).hasMessage("Attendance encryption is not configured");
    }
}
