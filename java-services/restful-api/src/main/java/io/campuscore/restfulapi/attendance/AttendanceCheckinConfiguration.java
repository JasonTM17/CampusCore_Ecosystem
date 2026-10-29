package io.campuscore.restfulapi.attendance;

import java.time.Clock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class AttendanceCheckinConfiguration {
    @Bean("attendanceClock")
    Clock attendanceClock() { return Clock.systemUTC(); }
}
