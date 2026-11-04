package io.campuscore.restfulapi.thesis;

import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

@SpringBootTest
@ActiveProfiles({"test", "persistence"})
class ThesisReportConcurrencyPostgresIT extends ThesisReportConcurrencyTest {
}
