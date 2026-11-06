package io.campuscore.restfulapi.engagement;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The repair copies each original insert body and changes no other column. */
class NewsBodyMigrationTest {
    @Test
    void repairMatchesTheOriginalInserts() throws Exception {
        Path dir = Path.of("src/main/resources/db/migration");
        Map<String, String> sources = new LinkedHashMap<>();
        for (String filename : OriginalAnnouncementBodies.SOURCE_FILES.values()) {
            sources.putIfAbsent(filename, Files.readString(dir.resolve(filename)));
        }
        String repair = Files.readString(dir.resolve("V154__restore_announcement_bodies.sql"));
        Map<String, String> expected = OriginalAnnouncementBodies.fromInserts(sources);
        Map<String, String> actual = OriginalAnnouncementBodies.fromRepair(repair);

        assertThat(actual).isEqualTo(expected);
        assertThat(repair).doesNotContain("SET \"summary\"").doesNotContain("SET title");
        assertThat(actual).hasSize(10);
    }
}
