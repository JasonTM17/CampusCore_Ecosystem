package io.campuscore.restfulapi.thesis;

import static org.assertj.core.api.Assertions.assertThat;

import io.campuscore.restfulapi.thesis.service.ReportFilePolicy;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;

class ReportFilePolicyTest {

    @Test
    void preservesPdfExtensionWhenSanitizingLongUnicodeNameWithPathAndControlCharacter() {
        String originalName = "C:\\private\\reports\\" + "é".repeat(240) + "\u0001.PDF";
        ReportFilePolicy.ValidatedFile file = ReportFilePolicy.validate(new MockMultipartFile(
                "file",
                originalName,
                "application/pdf",
                "%PDF-sample".getBytes(StandardCharsets.US_ASCII)));

        assertThat(file.fileName())
                .hasSizeLessThanOrEqualTo(200)
                .endsWith(".PDF")
                .doesNotContain("C:\\private\\reports\\", "\u0001");
        assertThat(file.extension()).isEqualTo("pdf");
    }

    @Test
    void preservesDocxExtensionWhenSanitizingLongUnicodePath() {
        String originalName = "/private/reports/" + "資料".repeat(120) + ".docx";
        ReportFilePolicy.ValidatedFile file = ReportFilePolicy.validate(new MockMultipartFile(
                "file",
                originalName,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                new byte[] {0x50, 0x4B, 0x03, 0x04}));

        assertThat(file.fileName())
                .hasSize(200)
                .startsWith("資料")
                .endsWith(".docx")
                .doesNotContain("/private/reports/");
        assertThat(file.extension()).isEqualTo("docx");
    }
}
