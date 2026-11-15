package io.campuscore.restfulapi.academic.registration;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.List;

public final class RegistrationDtos {

    private RegistrationDtos() {
    }

    @Schema(name = "RegistrationRoundResponse")
    public record RoundResponse(
            String id,
            String semesterId,
            String name,
            String kind,
            String status,
            Instant windowStart,
            Instant windowEnd,
            int creditLimit) {
    }

    public record EligibilityResponse(
            String roundId,
            String semesterId,
            String kind,
            boolean eligible,
            int creditLimit,
            int creditsUsed,
            int creditsRemaining,
            Instant windowStart,
            Instant windowEnd) {
    }

    public record CatalogSectionResponse(
            String id,
            String sectionNumber,
            String courseId,
            String courseCode,
            String courseName,
            String courseNameEn,
            String courseNameVi,
            int credits,
            int capacity,
            int enrolledCount,
            int remainingSeats,
            String status,
            boolean scheduleConflict,
            boolean alreadyEnrolled,
            List<SectionScheduleView> schedules,
            CurriculumRelevance curriculumRelevance,
            String departmentId,
            String departmentCode,
            String departmentName) {
    }

    /**
     * One weekly meeting time of a catalog section. Times are the stored
     * {@code HH:MM} strings; room is {@code building + " " + roomNumber} or
     * null when the schedule row has no classroom; lecturer is the assigned
     * lecturer's display name (via Section.lecturerId → Lecturer → User) or
     * null when the section has no lecturer assigned.
     */
    public record SectionScheduleView(
            @Schema(description = "Thứ trong tuần theo quy ước CampusCore: 1=Chủ Nhật, 2=Thứ Hai … 7=Thứ Bảy "
                    + "(giữ nguyên giá trị dayOfWeek trong DB, không đổi sang ISO Monday-first)",
                    example = "2")
            Integer dayOfWeek,
            @Schema(description = "Giờ bắt đầu dạng HH:MM", example = "07:00")
            String startTime,
            @Schema(description = "Giờ kết thúc dạng HH:MM", example = "09:30")
            String endTime,
            @Schema(description = "Phòng học dạng 'tòa nhà + số phòng', null khi chưa gán phòng", example = "A 101")
            String room,
            @Schema(description = "Tên giảng viên phụ trách, null khi lớp chưa phân công giảng viên", example = "Minh Nguyen")
            String lecturer) {
    }

    /**
     * Curriculum fit of a section's course relative to the requesting
     * student's curriculum: MANDATORY when the curriculum lists the course as
     * mandatory, ELECTIVE when listed as elective, OUTSIDE when the course is
     * not in the student's curriculum at all.
     */
    @Schema(description = "Mức độ liên quan của học phần với chương trình đào tạo của sinh viên")
    public enum CurriculumRelevance {
        @Schema(description = "Học phần bắt buộc trong chương trình đào tạo")
        MANDATORY,
        @Schema(description = "Học phần tự chọn trong chương trình đào tạo")
        ELECTIVE,
        @Schema(description = "Học phần ngoài chương trình đào tạo")
        OUTSIDE
    }

    public record SummaryResponse(
            String roundId,
            int creditLimit,
            int creditsUsed,
            int creditsRemaining,
            List<String> enrollmentIds) {
    }

    @Schema(description = "Kết quả hủy đăng ký lớp học phần")
    public record DropResponse(
            @Schema(description = "Thông báo kết quả hủy đăng ký", example = "Enrollment dropped successfully")
            String message) {
    }

    /** Study-program roadmap for the dedicated registration page. */
    @Schema(description = "Lộ trình chương trình đào tạo của sinh viên phục vụ đăng ký học phần")
    public record RoadmapResponse(
            RoadmapCurriculum curriculum,
            @Schema(description = "Học kỳ đích mà cờ openSectionCount được tính theo")
            String semesterId,
            List<RoadmapCourse> courses) {
    }

    public record RoadmapCurriculum(
            String id,
            String code,
            String name,
            String nameEn,
            String nameVi,
            int totalCredits) {
    }

    /**
     * One course in the student's study program with completion status and
     * whether it can be taken now (prerequisites met, sections offered).
     */
    public record RoadmapCourse(
            String courseId,
            String code,
            String name,
            String nameEn,
            String nameVi,
            int credits,
            int year,
            int semester,
            boolean isMandatory,
            @Schema(description = "COMPLETED | IN_PROGRESS | NOT_STARTED")
            String status,
            java.math.BigDecimal finalGrade,
            String letterGrade,
            List<RoadmapPrerequisite> prerequisites,
            boolean prerequisitesSatisfied,
            @Schema(description = "Số nhóm lớp mở trong học kỳ đích")
            int openSectionCount) {
    }

    /** One requirement row (PREREQ or COREQ) annotated with satisfaction. */
    public record RoadmapPrerequisite(
            String courseId,
            String code,
            String kind,
            String minLetterGrade,
            boolean satisfied) {
    }

    /** Student-declared intent to take a course (đăng ký nguyện vọng). */
    public record WishResponse(
            String id,
            String courseId,
            String courseCode,
            String courseName,
            String courseNameVi,
            int credits,
            String semesterId,
            int openSectionCount,
            boolean alreadyEnrolled,
            Instant createdAt) {
    }

    public record WishRequest(
            @Schema(description = "Mã học phần mong muốn đăng ký")
            String courseId,
            @Schema(description = "Học kỳ đích")
            String semesterId) {
    }
}
