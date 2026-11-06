package io.campuscore.restfulapi.engagement;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

/** The forward repair updates only the summary of each duplicated announcement. */
class NewsSummaryMigrationTest {
    private static final Pattern STATEMENT = Pattern.compile(
            "UPDATE engagement\\.\"Announcement\"\\s+SET \"summary\" = '((?:[^']|'')*)'\\s+WHERE \"id\" = '([^']+)';",
            Pattern.DOTALL);

    @Test
    void repairSetsOneDistinctSummaryPerIdAndNoOtherColumn() throws Exception {
        String sql = Files.readString(Path.of(
                "src/main/resources/db/migration/V153__distinct_announcement_summaries.sql"));
        String withoutComments = sql.replaceAll("(?m)^--.*$", "").trim();

        Map<String, String> found = new LinkedHashMap<>();
        Matcher matcher = STATEMENT.matcher(withoutComments);
        int end = 0;
        while (matcher.find()) {
            assertThat(matcher.start()).isEqualTo(end);
            found.put(matcher.group(2), matcher.group(1).replace("''", "'"));
            end = matcher.end();
            while (end < withoutComments.length() && Character.isWhitespace(withoutComments.charAt(end))) {
                end++;
            }
        }
        assertThat(end).isEqualTo(withoutComments.length());

        String correction = Files.readString(Path.of(
                "src/main/resources/db/migration/V155__career_fair_summary.sql")).trim();
        Matcher correctionMatcher = STATEMENT.matcher(correction);
        assertThat(correctionMatcher.matches()).isTrue();
        assertThat(correctionMatcher.group(2)).isEqualTo("announcement-ute-career-fair-tech-2026");
        found.put(correctionMatcher.group(2), correctionMatcher.group(1).replace("''", "'"));

        assertThat(found).isEqualTo(DistinctAnnouncementSummaries.BY_ID);
        assertThat(found.values()).doesNotHaveDuplicates();
        assertThat(found.values()).allSatisfy(summary -> assertThat(summary).hasSizeLessThanOrEqualTo(500));
        assertThat(sql)
                .doesNotContain("Thông báo kết quả đối soát GPA và điểm rèn luyện xét cấp Học bổng Khuyến khích học tập kỳ 1 năm học 2026-2027.")
                .doesNotContain("Khánh thành cụm máy chủ điện toán hiệu năng cao GPU NVIDIA A100 và hệ thống lưu trữ Ceph 500TB phục vụ nghiên cứu Big Data và AI.")
                .doesNotContain("Hơn 60 tập đoàn công nghệ tuyển dụng 1.200 vị trí kỹ sư phần mềm, AI, Cloud DevOps tại Ngày hội việc làm UTE Tech Career Expo 2026.")
                .doesNotContain("Kế hoạch đăng ký học phần trực tuyến, phân luồng theo khóa và quy định trần hạn mức 28 tín chỉ trên cổng CampusUTE.")
                .doesNotContain("Khoa Công nghệ Thông tin tổ chức bảo vệ Khóa luận tốt nghiệp đợt 2 cho 120 nhóm sinh viên trước 18 hội đồng chuyên môn.")
                .doesNotContain("Lễ tổng kết và trao giải Nghiên cứu Khoa học Sinh viên UTE 2026: 5 Giải Nhất, 10 Giải Nhì và nhiều dự án đăng ký sáng chế.");
    }
}
