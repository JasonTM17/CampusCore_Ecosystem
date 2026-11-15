package io.campuscore.restfulapi.academic.registration;

import io.campuscore.restfulapi.academic.registration.RegistrationDtos.CatalogSectionResponse;
import io.campuscore.restfulapi.academic.registration.RegistrationDtos.CurriculumRelevance;
import io.campuscore.restfulapi.academic.registration.RegistrationDtos.EligibilityResponse;
import io.campuscore.restfulapi.academic.registration.RegistrationDtos.RoadmapCourse;
import io.campuscore.restfulapi.academic.registration.RegistrationDtos.RoadmapCurriculum;
import io.campuscore.restfulapi.academic.registration.RegistrationDtos.RoadmapPrerequisite;
import io.campuscore.restfulapi.academic.registration.RegistrationDtos.RoadmapResponse;
import io.campuscore.restfulapi.academic.registration.RegistrationDtos.RoundResponse;
import io.campuscore.restfulapi.academic.registration.RegistrationDtos.SectionScheduleView;
import io.campuscore.restfulapi.academic.registration.RegistrationDtos.SummaryResponse;
import io.campuscore.restfulapi.academic.registration.RegistrationDtos.WishResponse;
import io.campuscore.restfulapi.academic.service.AcademicEnrollmentReadService;
import io.campuscore.restfulapi.academic.web.AcademicEnrollmentReadDtos.EnrollmentResponse;
import io.campuscore.restfulapi.web.DomainException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Savepoint;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Profile;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

@Service
@Profile("persistence")
public class RegistrationService {

    private static final String ROUND = "academic.\"RegistrationRound\"";
    private static final String COHORT = "academic.\"RegistrationRoundCohort\"";
    private static final String REQUIREMENT = "academic.\"CourseRequirement\"";
    private static final String IDEMPOTENCY = "academic.\"RegistrationIdempotency\"";
    private static final String EVENT = "academic.\"EnrollmentEvent\"";
    private static final String SLIP = "academic.\"RegistrationSlip\"";
    private static final String SECTION = "academic.\"Section\"";
    private static final String ENROLLMENT = "academic.\"Enrollment\"";
    private static final String COURSE = "academic.\"Course\"";
    private static final String STUDENT = "academic.\"Student\"";
    private static final String SCHEDULE = "academic.\"SectionSchedule\"";
    private static final String CLASSROOM = "academic.\"Classroom\"";
    private static final String LECTURER = "academic.\"Lecturer\"";
    private static final String SEMESTER = "academic.\"Semester\"";
    /** Display names live on the auth profile; same join convention as AcademicEnrollmentReadRepository. */
    private static final String AUTH_USER = "campuscore_auth.\"User\"";
    private static final String CURRICULUM_COURSE = "academic.\"CurriculumCourse\"";
    private static final String CURRICULUM = "academic.\"Curriculum\"";
    private static final String DEPARTMENT = "academic.\"Department\"";
    private static final String WISH = "academic.\"RegistrationWish\"";
    private static final int STANDARD_CREDIT_LIMIT = CreditLimitApplicationService.STANDARD_LIMIT;

    private static final Logger log = LoggerFactory.getLogger(RegistrationService.class);

    private final NamedParameterJdbcTemplate jdbc;
    private final AcademicEnrollmentReadService reads;
    private final RegistrationPdfRenderer pdfRenderer;
    private final CreditLimitApplicationService creditLimitApplications;
    private final BursarHoldGate bursarHolds;
    private final TransactionTemplate transactions;
    private final boolean postgres;

    public RegistrationService(
            NamedParameterJdbcTemplate jdbc,
            AcademicEnrollmentReadService reads,
            RegistrationPdfRenderer pdfRenderer,
            CreditLimitApplicationService creditLimitApplications,
            PlatformTransactionManager transactionManager) {
        this(jdbc, reads, pdfRenderer, creditLimitApplications, transactionManager, BursarHoldGate.disabled());
    }

    @Autowired
    public RegistrationService(
            NamedParameterJdbcTemplate jdbc,
            AcademicEnrollmentReadService reads,
            RegistrationPdfRenderer pdfRenderer,
            CreditLimitApplicationService creditLimitApplications,
            PlatformTransactionManager transactionManager,
            BursarHoldGate bursarHolds) {
        this.jdbc = jdbc;
        this.reads = reads;
        this.pdfRenderer = pdfRenderer;
        this.creditLimitApplications = creditLimitApplications;
        this.bursarHolds = bursarHolds;
        this.transactions = new TransactionTemplate(transactionManager);
        this.postgres = jdbc.getJdbcOperations().execute((ConnectionCallback<Boolean>) connection ->
                "PostgreSQL".equalsIgnoreCase(connection.getMetaData().getDatabaseProductName()));
    }

    public List<RoundResponse> listRounds(String semesterId) {
        MapSqlParameterSource parameters = new MapSqlParameterSource();
        String sql = "SELECT \"id\", \"semesterId\", \"name\", \"kind\", \"status\", \"windowStart\", \"windowEnd\", \"creditLimit\""
                + " FROM " + ROUND;
        if (semesterId != null && !semesterId.isBlank()) {
            sql += " WHERE \"semesterId\" = :semesterId";
            parameters.addValue("semesterId", semesterId);
        }
        sql += " ORDER BY \"windowStart\"";
        return jdbc.query(sql, parameters, (rs, rowNum) -> new RoundResponse(
                rs.getString("id"),
                rs.getString("semesterId"),
                rs.getString("name"),
                rs.getString("kind"),
                rs.getString("status"),
                timestamp(rs.getTimestamp("windowStart")),
                timestamp(rs.getTimestamp("windowEnd")),
                Math.min(STANDARD_CREDIT_LIMIT, rs.getInt("creditLimit"))));
    }

    @Transactional
    public EligibilityResponse eligibility(String studentId, String semesterId, String roundId) {
        Map<String, Object> student = requireStudent(studentId);
        Map<String, Object> round = roundId == null || roundId.isBlank()
                ? openReadRound(semesterId)
                : round(roundId);
        assertEligible(student, round, Instant.now());
        int used = creditsUsed(studentId, String.valueOf(round.get("semester_id")));
        int limit = creditLimitApplications.effectiveLimit(studentId, round);
        return new EligibilityResponse(
                String.valueOf(round.get("id")),
                String.valueOf(round.get("semester_id")),
                String.valueOf(round.get("kind")),
                true,
                limit,
                used,
                Math.max(0, limit - used),
                timestamp((Timestamp) round.get("window_start")),
                timestamp((Timestamp) round.get("window_end")));
    }

    /**
     * Query budget contract: catalog() runs a FIXED number of queries —
     * student (1), round (1), cohort gate (1), active enrollments (1), and ONE
     * fan-out fetch for catalog rows + schedules + curriculum relevance that
     * is grouped in memory. The budget does not grow with the section count
     * (no per-row schedule lookups); any new catalog field must stay batched —
     * a join or a single IN (...) query — never a per-row round trip.
     *
     * <p>Upper bound is 5 queries on the happy REGISTRATION path and 6 when the
     * ADD_DROP fallback re-opens the round (openReadRound retries once after
     * the REGISTRATION round is closed). Never let either path grow with the
     * catalog size.
     */
    @Transactional
    public List<CatalogSectionResponse> catalog(String studentId, String semesterId, String roundId) {
        return catalog(studentId, semesterId, roundId, null, null, null);
    }

    /**
     * Catalog filters applied after the fan-out grouping — the query budget
     * stays constant: mode=remaining/retake add ONE attempt-history query,
     * departmentId/search filter the already-fetched rows in memory.
     */
    public List<CatalogSectionResponse> catalog(String studentId, String semesterId, String roundId,
            String mode, String departmentId, String search) {
        String normalizedMode = mode == null || mode.isBlank() ? "all" : mode.trim().toLowerCase(Locale.ROOT);
        if (!Set.of("all", "curriculum", "remaining", "retake").contains(normalizedMode)) {
            throw problem(HttpStatus.BAD_REQUEST, "CATALOG_MODE_INVALID",
                    "mode must be one of all, curriculum, remaining, retake");
        }
        Map<String, Object> student = requireStudent(studentId);
        Map<String, Object> round = roundId == null || roundId.isBlank()
                ? openReadRound(semesterId)
                : round(roundId);
        assertEligible(student, round, Instant.now());
        String effectiveSemester = String.valueOf(round.get("semester_id"));
        List<Map<String, Object>> active = activeEnrollments(studentId, effectiveSemester);
        Set<String> enrolledSections = active.stream()
                .map(row -> String.valueOf(row.get("section_id")))
                .collect(Collectors.toCollection(LinkedHashSet::new));

        // One fan-out query: every section contributes at least one row
        // (sections without schedules yield a single row with null schedule
        // columns); sections with N schedule rows yield N rows. Grouped into
        // one response per section below, in result order.
        List<CatalogRow> rows = jdbc.query(
                "SELECT section.\"id\", section.\"sectionNumber\", section.\"courseId\", course.\"code\", course.\"name\","
                        + " course.\"nameEn\", course.\"nameVi\","
                        + " course.\"credits\", section.\"capacity\", section.\"enrolledCount\", section.\"status\","
                        + " schedule.\"dayOfWeek\" AS schedule_day, schedule.\"startTime\" AS schedule_start,"
                        + " schedule.\"endTime\" AS schedule_end,"
                        + " classroom.\"building\" AS room_building, classroom.\"roomNumber\" AS room_number,"
                        + " lecturer_user.\"firstName\" AS lecturer_first_name, lecturer_user.\"lastName\" AS lecturer_last_name,"
                        + " (SELECT cc.\"isMandatory\" FROM " + CURRICULUM_COURSE + " cc"
                        + "  WHERE cc.\"curriculumId\" = :curriculumId AND cc.\"courseId\" = section.\"courseId\" LIMIT 1)"
                        + "   AS curriculum_mandatory,"
                        + " course.\"departmentId\" AS department_id,"
                        + " department.\"code\" AS department_code, department.\"name\" AS department_name"
                        + " FROM " + SECTION + " section"
                        + " JOIN " + COURSE + " course ON course.\"id\" = section.\"courseId\""
                        + " LEFT JOIN " + DEPARTMENT + " department ON department.\"id\" = course.\"departmentId\""
                        + " LEFT JOIN " + SCHEDULE + " schedule ON schedule.\"sectionId\" = section.\"id\""
                        + " LEFT JOIN " + CLASSROOM + " classroom ON classroom.\"id\" = schedule.\"classroomId\""
                        + " LEFT JOIN " + LECTURER + " lecturer ON lecturer.\"id\" = section.\"lecturerId\""
                        + " LEFT JOIN " + AUTH_USER + " lecturer_user ON lecturer_user.\"id\" = lecturer.\"userId\""
                        + " WHERE section.\"semesterId\" = :semesterId"
                        + " ORDER BY course.\"code\", section.\"id\", schedule.\"dayOfWeek\", schedule.\"startTime\", schedule.\"id\"",
                new MapSqlParameterSource()
                        .addValue("curriculumId", student.get("curriculum_id"))
                        .addValue("semesterId", effectiveSemester),
                (rs, rowNum) -> {
                    TimeRange schedule = rs.getObject("schedule_day") == null ? null : new TimeRange(
                            rs.getInt("schedule_day"),
                            rs.getString("schedule_start"),
                            rs.getString("schedule_end"));
                    String building = rs.getString("room_building");
                    String roomNumber = rs.getString("room_number");
                    String room = building == null || roomNumber == null
                            ? null
                            : (building.trim() + " " + roomNumber.trim()).trim();
                    String lecturer = displayName(rs.getString("lecturer_first_name"), rs.getString("lecturer_last_name"));
                    boolean mandatory = rs.getBoolean("curriculum_mandatory");
                    CurriculumRelevance relevance = rs.wasNull()
                            ? CurriculumRelevance.OUTSIDE
                            : (mandatory ? CurriculumRelevance.MANDATORY : CurriculumRelevance.ELECTIVE);
                    return new CatalogRow(
                            rs.getString("id"),
                            rs.getString("sectionNumber"),
                            rs.getString("courseId"),
                            rs.getString("code"),
                            rs.getString("name"),
                            rs.getString("nameEn"),
                            rs.getString("nameVi"),
                            rs.getInt("credits"),
                            rs.getInt("capacity"),
                            rs.getInt("enrolledCount"),
                            rs.getString("status"),
                            schedule,
                            room,
                            lecturer,
                            relevance,
                            rs.getString("department_id"),
                            rs.getString("department_code"),
                            rs.getString("department_name"));
                });

        // Group the fan-out back to one response per section and compute the
        // schedule-conflict flag entirely in memory from the fetched ranges.
        Map<String, CatalogSectionResponse> bySection = new LinkedHashMap<>();
        for (CatalogRow row : rows) {
            CatalogSectionResponse assembled = bySection.get(row.id());
            List<TimeRange> scheduleRanges = row.schedule() == null
                    ? List.of()
                    : List.of(row.schedule());
            if (assembled == null) {
                bySection.put(row.id(), new CatalogSectionResponse(
                        row.id(),
                        row.sectionNumber(),
                        row.courseId(),
                        row.courseCode(),
                        row.courseName(),
                        row.courseNameEn(),
                        row.courseNameVi(),
                        row.credits(),
                        row.capacity(),
                        row.enrolledCount(),
                        Math.max(0, row.capacity() - row.enrolledCount()),
                        row.status(),
                        false,
                        enrolledSections.contains(row.id()),
                        row.schedule() == null
                                ? List.of()
                                : List.of(new SectionScheduleView(
                                        row.schedule().day(),
                                        row.schedule().start(),
                                        row.schedule().end(),
                                        row.room(),
                                        row.lecturer())),
                        row.relevance(),
                        row.departmentId(),
                        row.departmentCode(),
                        row.departmentName()));
                continue;
            }
            if (row.schedule() == null) {
                continue;
            }
            List<SectionScheduleView> schedules = new ArrayList<>(assembled.schedules());
            schedules.add(new SectionScheduleView(
                    row.schedule().day(),
                    row.schedule().start(),
                    row.schedule().end(),
                    row.room(),
                    row.lecturer()));
            bySection.put(row.id(), new CatalogSectionResponse(
                    assembled.id(),
                    assembled.sectionNumber(),
                    assembled.courseId(),
                    assembled.courseCode(),
                    assembled.courseName(),
                    assembled.courseNameEn(),
                    assembled.courseNameVi(),
                    assembled.credits(),
                    assembled.capacity(),
                    assembled.enrolledCount(),
                    assembled.remainingSeats(),
                    assembled.status(),
                    false,
                    assembled.alreadyEnrolled(),
                    List.copyOf(schedules),
                    assembled.curriculumRelevance(),
                    assembled.departmentId(),
                    assembled.departmentCode(),
                    assembled.departmentName()));
        }

        List<TimeRange> busy = new ArrayList<>();
        for (String enrolledSection : enrolledSections) {
            CatalogSectionResponse enrolled = bySection.get(enrolledSection);
            if (enrolled != null) {
                enrolled.schedules().forEach(view -> busy.add(
                        new TimeRange(view.dayOfWeek(), view.startTime(), view.endTime())));
            }
        }
        List<CatalogSectionResponse> catalog = new ArrayList<>(bySection.values());
        for (int index = 0; index < catalog.size(); index++) {
            CatalogSectionResponse current = catalog.get(index);
            boolean conflict = !enrolledSections.contains(current.id())
                    && overlaps(busy, current.schedules().stream()
                            .map(view -> new TimeRange(view.dayOfWeek(), view.startTime(), view.endTime()))
                            .toList());
            if (conflict) {
                catalog.set(index, new CatalogSectionResponse(
                        current.id(),
                        current.sectionNumber(),
                        current.courseId(),
                        current.courseCode(),
                        current.courseName(),
                        current.courseNameEn(),
                        current.courseNameVi(),
                        current.credits(),
                        current.capacity(),
                        current.enrolledCount(),
                        current.remainingSeats(),
                        current.status(),
                        true,
                        current.alreadyEnrolled(),
                        current.schedules(),
                        current.curriculumRelevance(),
                        current.departmentId(),
                        current.departmentCode(),
                        current.departmentName()));
            }
        }
        return filterCatalog(catalog, normalizedMode, departmentId, search, studentId);
    }

    private List<CatalogSectionResponse> filterCatalog(List<CatalogSectionResponse> catalog,
            String mode, String departmentId, String search, String studentId) {
        if (departmentId != null && !departmentId.isBlank()) {
            String wanted = departmentId.trim();
            catalog.removeIf(section -> !wanted.equals(section.departmentId()));
        }
        if (search != null && !search.isBlank()) {
            String needle = search.trim().toLowerCase(Locale.ROOT);
            catalog.removeIf(section -> !containsIgnoreCase(section.courseCode(), needle)
                    && !containsIgnoreCase(section.courseName(), needle)
                    && !containsIgnoreCase(section.courseNameEn(), needle)
                    && !containsIgnoreCase(section.courseNameVi(), needle));
        }
        if ("all".equals(mode)) {
            return catalog;
        }
        if ("curriculum".equals(mode)) {
            catalog.removeIf(section -> section.curriculumRelevance() == CurriculumRelevance.OUTSIDE);
            return catalog;
        }
        // Attempt history drives both remaining (not yet passed) and retake
        // (failed or dropped before). One extra constant query per catalog call.
        Set<String> passedCourseIds = new LinkedHashSet<>();
        Set<String> retakeableCourseIds = new LinkedHashSet<>();
        for (Map<String, Object> row : jdbc.queryForList(
                "SELECT \"courseId\" AS course_id, \"letterGrade\" AS letter_grade, \"status\" AS enrollment_status"
                        + " FROM " + ENROLLMENT + " WHERE \"studentId\" = :studentId",
                new MapSqlParameterSource("studentId", studentId))) {
            String courseId = String.valueOf(row.get("course_id"));
            String letter = row.get("letter_grade") == null ? null : String.valueOf(row.get("letter_grade"));
            String status = String.valueOf(row.get("enrollment_status"));
            if (letter != null && !"F".equalsIgnoreCase(letter) && !"W".equalsIgnoreCase(letter)) {
                passedCourseIds.add(courseId);
            }
            if ((letter != null && ("F".equalsIgnoreCase(letter) || "W".equalsIgnoreCase(letter)))
                    || "DROPPED".equals(status)) {
                retakeableCourseIds.add(courseId);
            }
        }
        if ("remaining".equals(mode)) {
            catalog.removeIf(section -> section.curriculumRelevance() == CurriculumRelevance.OUTSIDE
                    || section.alreadyEnrolled()
                    || passedCourseIds.contains(section.courseId()));
        } else if ("retake".equals(mode)) {
            catalog.removeIf(section -> !retakeableCourseIds.contains(section.courseId()));
        }
        return catalog;
    }

    private static boolean containsIgnoreCase(String haystack, String needleLower) {
        return haystack != null && haystack.toLowerCase(Locale.ROOT).contains(needleLower);
    }

    /**
     * Registration roadmap: the student's study program with per-course
     * completion status, prerequisite satisfaction, and how many sections are
     * offered in the target semester. Fixed query budget: student (1),
     * curriculum (1), plan (1), attempt history (1), requirements (1),
     * section counts (1) — independent of plan size.
     */
    @Transactional(readOnly = true)
    public RoadmapResponse roadmap(String studentId, String semesterId) {
        Map<String, Object> student = requireStudent(studentId);
        String targetSemester = resolveTargetSemester(semesterId);
        String curriculumId = String.valueOf(student.get("curriculum_id"));
        Map<String, Object> curriculum;
        try {
            curriculum = jdbc.queryForMap(
                    "SELECT \"id\", \"code\", \"name\", \"nameEn\", \"nameVi\", \"totalCredits\" FROM " + CURRICULUM
                            + " WHERE \"id\" = :id",
                    new MapSqlParameterSource("id", curriculumId));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "CURRICULUM_NOT_FOUND", "No study program is assigned to this student");
        }
        List<Map<String, Object>> plan = jdbc.queryForList(
                "SELECT cc.\"courseId\" AS course_id, cc.\"year\" AS plan_year, cc.\"semester\" AS plan_semester,"
                        + " cc.\"isMandatory\" AS is_mandatory,"
                        + " course.\"code\", course.\"name\", course.\"nameEn\", course.\"nameVi\", course.\"credits\""
                        + " FROM " + CURRICULUM_COURSE + " cc"
                        + " JOIN " + COURSE + " course ON course.\"id\" = cc.\"courseId\""
                        + " WHERE cc.\"curriculumId\" = :curriculumId"
                        + " ORDER BY cc.\"year\", cc.\"semester\", course.\"code\"",
                new MapSqlParameterSource("curriculumId", curriculumId));
        List<String> planCourseIds = plan.stream()
                .map(row -> String.valueOf(row.get("course_id")))
                .toList();

        // One attempt-history query feeds both completion status and prereq
        // satisfaction; passing letters reuse the same F/W exclusion rule as
        // completedLetters().
        Map<String, String> bestLetterByCourse = new LinkedHashMap<>();
        Set<String> inProgressCourseIds = new LinkedHashSet<>();
        Map<String, java.math.BigDecimal> finalGradeByCourse = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbc.queryForList(
                "SELECT \"courseId\" AS course_id, \"letterGrade\" AS letter_grade, \"status\" AS enrollment_status,"
                        + " \"semesterId\" AS semester_id, \"gradeStatus\" AS grade_status, \"finalGrade\" AS final_grade"
                        + " FROM " + ENROLLMENT + " WHERE \"studentId\" = :studentId",
                new MapSqlParameterSource("studentId", studentId))) {
            String courseId = String.valueOf(row.get("course_id"));
            String status = String.valueOf(row.get("enrollment_status"));
            if (Set.of("ENROLLED", "PENDING", "CONFIRMED").contains(status)
                    && targetSemester.equals(String.valueOf(row.get("semester_id")))) {
                inProgressCourseIds.add(courseId);
            }
            String letter = row.get("letter_grade") == null ? null : String.valueOf(row.get("letter_grade"));
            String gradeStatus = String.valueOf(row.get("grade_status"));
            boolean passing = letter != null
                    && !"F".equalsIgnoreCase(letter) && !"W".equalsIgnoreCase(letter)
                    && (Set.of("PUBLISHED", "APPEALED").contains(gradeStatus) || "COMPLETED".equals(status));
            if (passing && satisfiesLetterFloor(List.of(letter), null)) {
                bestLetterByCourse.merge(courseId, letter,
                        (a, b) -> LETTER_RANK.getOrDefault(b, -1) > LETTER_RANK.getOrDefault(a, -1) ? b : a);
                finalGradeByCourse.put(courseId, (java.math.BigDecimal) row.get("final_grade"));
            }
        }

        List<Map<String, Object>> requirements = planCourseIds.isEmpty()
                ? List.of()
                : jdbc.queryForList(
                        "SELECT requirement.\"courseId\" AS course_id, requirement.\"requiredCourseId\" AS required_id,"
                                + " requirement.\"kind\", requirement.\"minLetterGrade\" AS min_letter_grade,"
                                + " required.\"code\" AS required_code"
                                + " FROM " + REQUIREMENT + " requirement"
                                + " JOIN " + COURSE + " required ON required.\"id\" = requirement.\"requiredCourseId\""
                                + " WHERE requirement.\"courseId\" IN (:courseIds)",
                        new MapSqlParameterSource("courseIds", planCourseIds));
        Map<String, List<Map<String, Object>>> requirementsByCourse = new LinkedHashMap<>();
        for (Map<String, Object> requirement : requirements) {
            requirementsByCourse
                    .computeIfAbsent(String.valueOf(requirement.get("course_id")), key -> new ArrayList<>())
                    .add(requirement);
        }

        Map<String, Integer> openSectionCounts = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbc.queryForList(
                "SELECT \"courseId\" AS course_id, COUNT(*) AS section_count FROM " + SECTION
                        + " WHERE \"semesterId\" = :semesterId GROUP BY \"courseId\"",
                new MapSqlParameterSource("semesterId", targetSemester))) {
            openSectionCounts.put(String.valueOf(row.get("course_id")),
                    ((Number) row.get("section_count")).intValue());
        }

        List<RoadmapCourse> courses = new ArrayList<>();
        for (Map<String, Object> item : plan) {
            String courseId = String.valueOf(item.get("course_id"));
            String status = bestLetterByCourse.containsKey(courseId)
                    ? "COMPLETED"
                    : inProgressCourseIds.contains(courseId) ? "IN_PROGRESS" : "NOT_STARTED";
            List<RoadmapPrerequisite> prerequisites = new ArrayList<>();
            boolean prerequisitesSatisfied = true;
            for (Map<String, Object> requirement : requirementsByCourse.getOrDefault(courseId, List.of())) {
                String requiredId = String.valueOf(requirement.get("required_id"));
                String kind = String.valueOf(requirement.get("kind"));
                String minLetter = requirement.get("min_letter_grade") == null
                        ? null : String.valueOf(requirement.get("min_letter_grade"));
                boolean satisfied = "PREREQ".equals(kind)
                        ? satisfiesLetterFloor(
                                bestLetterByCourse.containsKey(requiredId)
                                        ? List.of(bestLetterByCourse.get(requiredId)) : List.of(),
                                minLetter)
                        : bestLetterByCourse.containsKey(requiredId) || inProgressCourseIds.contains(requiredId);
                prerequisites.add(new RoadmapPrerequisite(
                        requiredId, String.valueOf(requirement.get("required_code")),
                        kind, minLetter, satisfied));
                if ("PREREQ".equals(kind) && !satisfied) {
                    prerequisitesSatisfied = false;
                }
            }
            courses.add(new RoadmapCourse(
                    courseId,
                    String.valueOf(item.get("code")),
                    String.valueOf(item.get("name")),
                    (String) item.get("nameEn"),
                    (String) item.get("nameVi"),
                    ((Number) item.get("credits")).intValue(),
                    ((Number) item.get("plan_year")).intValue(),
                    ((Number) item.get("plan_semester")).intValue(),
                    (Boolean) item.get("is_mandatory"),
                    status,
                    finalGradeByCourse.get(courseId),
                    bestLetterByCourse.get(courseId),
                    List.copyOf(prerequisites),
                    prerequisitesSatisfied,
                    openSectionCounts.getOrDefault(courseId, 0)));
        }
        return new RoadmapResponse(
                new RoadmapCurriculum(
                        String.valueOf(curriculum.get("id")),
                        String.valueOf(curriculum.get("code")),
                        String.valueOf(curriculum.get("name")),
                        (String) curriculum.get("nameEn"),
                        (String) curriculum.get("nameVi"),
                        ((Number) curriculum.get("totalCredits")).intValue()),
                targetSemester,
                List.copyOf(courses));
    }

    /** Target semester for roadmap/wishlist screens: explicit param, else the open round's, else latest by start date. */
    private String resolveTargetSemester(String semesterId) {
        if (semesterId != null && !semesterId.isBlank()) {
            return semesterId;
        }
        try {
            return String.valueOf(openReadRound(null).get("semester_id"));
        } catch (DomainException exception) {
            // No open round — the roadmap is still useful for planning; fall
            // back to the most recent semester.
        }
        List<String> latest = jdbc.queryForList(
                "SELECT \"id\" FROM " + SEMESTER + " ORDER BY \"startDate\" DESC NULLS LAST LIMIT 1",
                new MapSqlParameterSource(), String.class);
        if (latest.isEmpty()) {
            throw problem(HttpStatus.NOT_FOUND, "SEMESTER_NOT_FOUND", "No semester is available");
        }
        return latest.getFirst();
    }

    /** Student's declared wishes (đăng ký nguyện vọng) for a semester. */
    @Transactional(readOnly = true)
    public List<WishResponse> wishes(String studentId, String semesterId) {
        requireStudent(studentId);
        String targetSemester = resolveTargetSemester(semesterId);
        Set<String> enrolledCourseIds = activeEnrollments(studentId, targetSemester).stream()
                .map(row -> String.valueOf(row.get("course_id")))
                .collect(Collectors.toCollection(LinkedHashSet::new));
        Map<String, Integer> openSectionCounts = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbc.queryForList(
                "SELECT \"courseId\" AS course_id, COUNT(*) AS section_count FROM " + SECTION
                        + " WHERE \"semesterId\" = :semesterId GROUP BY \"courseId\"",
                new MapSqlParameterSource("semesterId", targetSemester))) {
            openSectionCounts.put(String.valueOf(row.get("course_id")),
                    ((Number) row.get("section_count")).intValue());
        }
        List<WishResponse> wishes = new ArrayList<>();
        for (Map<String, Object> row : jdbc.queryForList(
                "SELECT wish.\"id\", wish.\"courseId\" AS course_id, wish.\"createdAt\" AS created_at,"
                        + " course.\"code\", course.\"name\", course.\"nameVi\", course.\"credits\""
                        + " FROM " + WISH + " wish"
                        + " JOIN " + COURSE + " course ON course.\"id\" = wish.\"courseId\""
                        + " WHERE wish.\"studentId\" = :studentId AND wish.\"semesterId\" = :semesterId"
                        + " ORDER BY course.\"code\"",
                new MapSqlParameterSource()
                        .addValue("studentId", studentId)
                        .addValue("semesterId", targetSemester))) {
            String courseId = String.valueOf(row.get("course_id"));
            wishes.add(new WishResponse(
                    String.valueOf(row.get("id")),
                    courseId,
                    String.valueOf(row.get("code")),
                    String.valueOf(row.get("name")),
                    (String) row.get("nameVi"),
                    ((Number) row.get("credits")).intValue(),
                    targetSemester,
                    openSectionCounts.getOrDefault(courseId, 0),
                    enrolledCourseIds.contains(courseId),
                    timestamp((Timestamp) row.get("created_at"))));
        }
        return wishes;
    }

    /**
     * Declare intent to take a course (nguyện vọng — PTIT-style wishlist for
     * courses the student cannot or does not yet register for). Idempotent on
     * (student, course, semester); rejected when already enrolled that term.
     */
    @Transactional
    public WishResponse addWish(String studentId, String courseId, String semesterId, String idempotencyKey) {
        requireKey(idempotencyKey);
        requireStudent(studentId);
        if (courseId == null || courseId.isBlank() || semesterId == null || semesterId.isBlank()) {
            throw problem(HttpStatus.BAD_REQUEST, "WISH_INVALID", "courseId and semesterId are required");
        }
        try {
            jdbc.queryForMap("SELECT \"id\" FROM " + COURSE + " WHERE \"id\" = :id AND \"isActive\" = true",
                    new MapSqlParameterSource("id", courseId));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "COURSE_NOT_FOUND", "Course not found");
        }
        try {
            jdbc.queryForMap("SELECT \"id\" FROM " + SEMESTER + " WHERE \"id\" = :id",
                    new MapSqlParameterSource("id", semesterId));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "SEMESTER_NOT_FOUND", "Semester not found");
        }
        if (!activeCourseIds(studentId, semesterId, List.of(courseId)).isEmpty()) {
            throw problem(HttpStatus.CONFLICT, "ALREADY_ENROLLED", "Already enrolled in this course");
        }
        String wishId = "wish-" + UUID.randomUUID();
        try {
            jdbc.update(
                    "INSERT INTO " + WISH + " (\"id\", \"studentId\", \"courseId\", \"semesterId\")"
                            + " VALUES (:id, :studentId, :courseId, :semesterId)",
                    new MapSqlParameterSource()
                            .addValue("id", wishId)
                            .addValue("studentId", studentId)
                            .addValue("courseId", courseId)
                            .addValue("semesterId", semesterId));
        } catch (DataIntegrityViolationException exception) {
            throw problem(HttpStatus.CONFLICT, "WISH_DUPLICATE", "This course is already on the wishlist");
        }
        return wishes(studentId, semesterId).stream()
                .filter(wish -> wish.id().equals(wishId))
                .findFirst()
                .orElseThrow(() -> problem(HttpStatus.INTERNAL_SERVER_ERROR, "WISH_READBACK_FAILED",
                        "Wish could not be reloaded"));
    }

    @Transactional
    public void removeWish(String studentId, String wishId) {
        requireStudent(studentId);
        int removed = jdbc.update(
                "DELETE FROM " + WISH + " WHERE \"id\" = :id AND \"studentId\" = :studentId",
                new MapSqlParameterSource()
                        .addValue("id", wishId)
                        .addValue("studentId", studentId));
        if (removed == 0) {
            throw problem(HttpStatus.NOT_FOUND, "WISH_NOT_FOUND", "Wishlist entry not found");
        }
    }

    @Transactional
    public SummaryResponse summary(String studentId, String semesterId) {
        requireStudent(studentId);
        Map<String, Object> round = openReadRound(semesterId);
        int used = creditsUsed(studentId, String.valueOf(round.get("semester_id")));
        int limit = creditLimitApplications.effectiveLimit(studentId, round);
        List<String> ids = activeEnrollments(studentId, String.valueOf(round.get("semester_id"))).stream()
                .map(row -> String.valueOf(row.get("id")))
                .toList();
        return new SummaryResponse(String.valueOf(round.get("id")), limit, used, Math.max(0, limit - used), ids);
    }

    public EnrollmentResponse enroll(
            String studentId,
            String sectionId,
            List<String> roles,
            String idempotencyKey) {
        requireKey(idempotencyKey);
        if (studentId == null || studentId.isBlank()) {
            throw problem(HttpStatus.FORBIDDEN, "STUDENT_PROFILE_REQUIRED", "Student profile is required");
        }
        String hash = sha256("ENROLL|" + sectionId);
        EnrollmentResponse response = transactions.execute(status ->
                enrollLocked(studentId, sectionId, roles, idempotencyKey, hash));
        if (response == null) {
            throw problem(HttpStatus.INTERNAL_SERVER_ERROR, "ENROLLMENT_FAILED", "Enrollment transaction returned no result");
        }
        return response;
    }

    public void drop(String enrollmentId, String studentId, List<String> roles, String idempotencyKey) {
        drop(enrollmentId, studentId, roles, idempotencyKey, null);
    }

    public void drop(String enrollmentId, String studentId, List<String> roles, String idempotencyKey,
            String actorId) {
        requireKey(idempotencyKey);
        boolean admin = roles != null && (roles.contains("ADMIN") || roles.contains("SUPER_ADMIN"));
        if (!admin && (studentId == null || studentId.isBlank())) {
            throw problem(HttpStatus.FORBIDDEN, "STUDENT_PROFILE_REQUIRED", "Student profile is required");
        }
        String hash = sha256("DROP|" + enrollmentId);
        // Self-service drops record the student profile id (same convention as
        // the ENROLL event); privileged drops record the caller's user id (same
        // convention as ADMIN_DELETE) so an admin who happens to hold a student
        // profile is not misattributed as the enrollment owner.
        String resolvedActor = admin ? actorId : studentId;
        transactions.executeWithoutResult(status -> dropLocked(enrollmentId, studentId, roles, idempotencyKey, hash,
                resolvedActor));
    }

    @Transactional
    public SlipPayload slip(String studentId, String semesterId) {
        // Regeneration writes the same cache that enroll/drop invalidate. Hold
        // their Student lock before reading either cache or roster, through
        // rendering and persistence, so a drop cannot retire a snapshot and
        // then have this request reinsert it. No Section/Enrollment lock is
        // acquired first: the established writer order stays unchanged.
        lockStudent(studentId);
        MapSqlParameterSource parameters = new MapSqlParameterSource("studentId", studentId);
        String sql = "SELECT \"semesterId\", \"sha256\", \"payload\" FROM " + SLIP + " WHERE \"studentId\" = :studentId";
        if (semesterId != null && !semesterId.isBlank()) {
            sql += " AND \"semesterId\" = :semesterId";
            parameters.addValue("semesterId", semesterId);
        }
        sql += " ORDER BY \"createdAt\" DESC";
        List<Map<String, Object>> rows = jdbc.queryForList(sql, parameters);
        String targetSemesterId = semesterId;
        List<Map<String, Object>> active = null;
        if (!rows.isEmpty()) {
            Map<String, Object> row = rows.get(0);
            byte[] payload = payloadBytes(row.get("payload"));
            if (isValidPdf(payload)) {
                String cachedSemesterId = String.valueOf(row.get("semesterId")).trim();
                List<Map<String, Object>> cachedRoster = activeEnrollments(studentId, cachedSemesterId);
                if (cachedRoster.isEmpty()) {
                    // Only completed history justifies an empty active roster;
                    // an all-dropped term must not certify a retired snapshot.
                    cachedRoster = completedEnrollmentsForSlip(studentId, cachedSemesterId);
                    if (!cachedRoster.isEmpty()) {
                        RenderedSlip expected = renderActiveRoster(studentId, cachedSemesterId, cachedRoster);
                        String storedDigest = String.valueOf(row.get("sha256")).trim();
                        if (expected.sha256().equals(storedDigest) && expected.sha256().equals(sha256(payload))) {
                            return new SlipPayload(storedDigest, payload);
                        }
                    }
                } else {
                    RenderedSlip expected = renderActiveRoster(studentId, cachedSemesterId, cachedRoster);
                    String storedDigest = String.valueOf(row.get("sha256")).trim();
                    if (expected.sha256().equals(storedDigest) && expected.sha256().equals(sha256(payload))) {
                        return new SlipPayload(storedDigest, payload);
                    }
                }
                // A valid PDF is not proof that it represents the current roster.
                targetSemesterId = cachedSemesterId;
                active = cachedRoster;
            }
        }

        if (targetSemesterId == null || targetSemesterId.isBlank()) {
            // Resolve the semester of the student's latest active enrollment.
            // Ordering raw semester ids lexically can pick a historical semester
            // whose rows are all COMPLETED/DROPPED and produce a false 404.
            List<String> semesters = jdbc.queryForList(
                    "SELECT \"semesterId\" FROM " + ENROLLMENT + " WHERE \"studentId\" = :studentId"
                            + " AND \"status\" IN ('ENROLLED', 'PENDING', 'CONFIRMED')"
                            + " ORDER BY \"enrolledAt\" DESC LIMIT 1",
                    new MapSqlParameterSource("studentId", studentId), String.class);
            if (!semesters.isEmpty()) {
                targetSemesterId = semesters.get(0);
            }
        }
        if (targetSemesterId != null && !targetSemesterId.isBlank()) {
            if (active == null) {
                active = activeEnrollments(studentId, targetSemesterId);
            }
            if (!active.isEmpty()) {
                RenderedSlip rendered = renderActiveRoster(studentId, targetSemesterId, active);
                String roundId = resolveSlipRoundId(active.get(0), targetSemesterId);
                if (roundId != null && !roundId.isBlank()) {
                    try {
                        jdbc.update(
                                "DELETE FROM " + SLIP + " WHERE \"studentId\" = :studentId AND \"semesterId\" = :semesterId",
                                new MapSqlParameterSource()
                                        .addValue("studentId", studentId)
                                        .addValue("semesterId", targetSemesterId));
                        MapSqlParameterSource insertParameters = new MapSqlParameterSource()
                                .addValue("id", UUID.randomUUID().toString())
                                .addValue("studentId", studentId)
                                .addValue("semesterId", targetSemesterId)
                                .addValue("roundId", roundId)
                                .addValue("sha", rendered.sha256())
                                .addValue("size", rendered.payload().length)
                                .addValue("payload", rendered.payload());
                        // PostgreSQL aborts the whole transaction on a failed
                        // statement; the best-effort INSERT runs behind a
                        // savepoint on the request connection so a failure
                        // rolls back only itself — the stale-row DELETE above
                        // still commits. PROPAGATION_NESTED is unavailable on
                        // the JPA manager and a second transaction would
                        // deadlock on the held Student row lock.
                        jdbc.getJdbcOperations().execute((ConnectionCallback<Void>) connection -> {
                            Savepoint savepoint = connection.setSavepoint();
                            try {
                                jdbc.update(
                                        "INSERT INTO " + SLIP
                                                + " (\"id\", \"studentId\", \"semesterId\", \"roundId\", \"sha256\", \"byteSize\", \"payload\")"
                                                + " VALUES (:id, :studentId, :semesterId, :roundId, :sha, :size, :payload)",
                                        insertParameters);
                                connection.releaseSavepoint(savepoint);
                            } catch (DataAccessException | SQLException failure) {
                                try {
                                    connection.rollback(savepoint);
                                } catch (SQLException rollbackFailure) {
                                    failure.addSuppressed(rollbackFailure);
                                }
                                throw failure;
                            }
                            return null;
                        });
                    } catch (DataAccessException failure) {
                        log.warn("registration slip cache persistence skipped; exceptionType={}",
                                failure.getClass().getSimpleName());
                    }
                }
                return new SlipPayload(rendered.sha256(), rendered.payload());
            }
        }

        throw problem(HttpStatus.NOT_FOUND, "ROUND_NOT_FOUND", "Registration slip not found");
    }

    private RenderedSlip renderActiveRoster(
            String studentId,
            String semesterId,
            List<Map<String, Object>> active) {
        Map<String, Object> first = active.get(0);
        String studentCode = studentId;
        String studentName = null;
        String semesterName = semesterId;
        // Cosmetic fields come from ONE non-throwing lookup — LEFT JOINs keep
        // missing name/semester data from raising (Student.id is the PK, so at
        // most one row), and a real statement failure propagates instead of
        // poisoning the request transaction behind a swallowed exception.
        List<Map<String, Object>> infos = jdbc.queryForList(
                "SELECT s.\"studentId\" AS student_code, u.\"firstName\" AS first_name,"
                        + " u.\"lastName\" AS last_name, semester.\"name\" AS semester_name"
                        + " FROM " + STUDENT + " s"
                        + " LEFT JOIN " + AUTH_USER + " u ON u.\"id\" = s.\"userId\""
                        + " LEFT JOIN " + SEMESTER + " semester ON semester.\"id\" = :semesterId"
                        + " WHERE s.\"id\" = :studentId",
                new MapSqlParameterSource("studentId", studentId)
                        .addValue("semesterId", semesterId));
        if (!infos.isEmpty()) {
            Map<String, Object> info = infos.get(0);
            if (info.get("student_code") != null) {
                studentCode = String.valueOf(info.get("student_code"));
            }
            studentName = displayName(
                    (String) info.get("first_name"),
                    (String) info.get("last_name"));
            if (info.get("semester_name") != null) {
                semesterName = String.valueOf(info.get("semester_name"));
            }
        }

        List<RegistrationPdfRenderer.CourseItem> courseItems = active.stream()
                .map(row -> new RegistrationPdfRenderer.CourseItem(
                        String.valueOf(row.get("course_code")),
                        String.valueOf(row.get("course_name")),
                        String.valueOf(row.get("section_number")),
                        ((Number) row.get("credits")).intValue(),
                        String.valueOf(row.get("id")),
                        String.valueOf(row.get("section_id"))))
                .toList();
        byte[] payload = pdfRenderer.renderEnriched(
                studentId,
                studentCode,
                studentName,
                semesterId,
                semesterName,
                String.valueOf(first.get("id")),
                String.valueOf(first.get("section_id")),
                courseItems);
        return new RenderedSlip(sha256(payload), payload);
    }

    private String resolveSlipRoundId(Map<String, Object> first, String semesterId) {
        String roundId = first.get("round_id") == null ? null : String.valueOf(first.get("round_id"));
        // Enrollment.roundId carries no FK — a dangling value must not reach
        // the slip cache INSERT (it would fail the RegistrationSlip.roundId FK
        // on every request). Only trust it when the round still exists;
        // otherwise fall through to the live-round lookups below.
        if (roundId != null && !roundId.isBlank()
                && !jdbc.queryForList(
                        "SELECT \"id\" FROM " + ROUND + " WHERE \"id\" = :roundId",
                        new MapSqlParameterSource("roundId", roundId), String.class).isEmpty()) {
            return roundId;
        }
        List<String> roundIds = jdbc.queryForList(
                "SELECT \"id\" FROM " + ROUND + " WHERE \"semesterId\" = :semesterId ORDER BY \"windowStart\" DESC",
                new MapSqlParameterSource("semesterId", semesterId),
                String.class);
        if (!roundIds.isEmpty()) {
            return roundIds.get(0);
        }
        List<String> fallbackRounds = jdbc.queryForList(
                "SELECT \"id\" FROM " + ROUND + " ORDER BY \"windowStart\" DESC",
                new MapSqlParameterSource(),
                String.class);
        return fallbackRounds.isEmpty() ? null : fallbackRounds.get(0);
    }

    private static boolean isValidPdf(byte[] data) {
        if (data == null || data.length < 50) return false;
        String s = new String(data, StandardCharsets.US_ASCII);
        return s.startsWith("%PDF-") && s.contains("startxref") && s.contains("%%EOF");
    }

    public record SlipPayload(String sha256, byte[] payload) {
    }

    private record RenderedSlip(String sha256, byte[] payload) {
    }

    private EnrollmentResponse enrollLocked(
            String studentId,
            String sectionId,
            List<String> roles,
            String idempotencyKey,
            String hash) {
        Map<String, Object> replay = claimIdempotency(studentId, idempotencyKey, hash);
        if (replay != null) {
            return replayedEnrollment(replay, roles, studentId);
        }
        bursarHolds.assertEnrollable(studentId);
        Map<String, Object> student = lockStudent(studentId);
        Map<String, Object> section = lockSection(sectionId);
        String semesterId = String.valueOf(section.get("semester_id"));
        String courseId = String.valueOf(section.get("course_id"));
        int credits = ((Number) section.get("credits")).intValue();
        if (!"OPEN".equals(String.valueOf(section.get("status")))) {
            throw problem(HttpStatus.CONFLICT, "SECTION_CLOSED", "Section is not open for registration");
        }
        Map<String, Object> round = openRoundReadOnly(semesterId, "REGISTRATION");
        assertEligible(student, round, Instant.now());
        List<Map<String, Object>> active = lockActiveEnrollments(studentId, semesterId);
        if (active.stream().anyMatch(row -> sectionId.equals(String.valueOf(row.get("section_id"))))) {
            throw problem(HttpStatus.CONFLICT, "ENROLLMENT_DUPLICATE", "Student is already enrolled in this section");
        }
        if (active.stream().anyMatch(row -> courseId.equals(String.valueOf(row.get("course_id"))))) {
            throw problem(HttpStatus.CONFLICT, "DUPLICATE_COURSE", "Student already has this course this term");
        }
        int used = active.stream().mapToInt(row -> ((Number) row.get("credits")).intValue()).sum();
        int limit = creditLimitApplications.effectiveLimit(studentId, round);
        if (used + credits > limit) {
            throw problem(HttpStatus.UNPROCESSABLE_ENTITY, "CREDIT_CAP_EXCEEDED", "Credit cap exceeded");
        }
        assertPrereqAndCoreq(studentId, courseId, semesterId, List.of(sectionId));
        if (overlaps(
                schedulesForSections(active.stream().map(row -> String.valueOf(row.get("section_id"))).toList()),
                schedulesForSection(sectionId))) {
            throw problem(HttpStatus.CONFLICT, "SCHEDULE_CONFLICT", "Section overlaps an enrolled meeting time");
        }
        int updated = jdbc.update(
                "UPDATE " + SECTION
                        + " SET \"enrolledCount\" = \"enrolledCount\" + 1, \"version\" = \"version\" + 1,"
                        + " \"updatedAt\" = CURRENT_TIMESTAMP WHERE \"id\" = :id AND \"enrolledCount\" < \"capacity\""
                        + " AND \"status\" = 'OPEN'",
                new MapSqlParameterSource("id", sectionId));
        if (updated == 0) {
            throw problem(HttpStatus.CONFLICT, "SECTION_FULL", "Section is full");
        }
        String enrollmentId = UUID.randomUUID().toString();
        Instant now = Instant.now();
        jdbc.update(
                "INSERT INTO " + ENROLLMENT
                        + " (\"id\", \"studentId\", \"sectionId\", \"semesterId\", \"status\", \"enrolledAt\","
                        + " \"gradeStatus\", \"courseId\", \"roundId\", \"creditsSnapshot\", \"version\")"
                        + " VALUES (:id, :studentId, :sectionId, :semesterId, 'ENROLLED', :now, 'NOT_GRADED',"
                        + " :courseId, :roundId, :credits, 0)",
                new MapSqlParameterSource()
                        .addValue("id", enrollmentId)
                        .addValue("studentId", studentId)
                        .addValue("sectionId", sectionId)
                        .addValue("semesterId", semesterId)
                        .addValue("now", Timestamp.from(now))
                        .addValue("courseId", courseId)
                        .addValue("roundId", round.get("id"))
                        .addValue("credits", credits));
        jdbc.update(
                "INSERT INTO " + EVENT
                        + " (\"id\", \"enrollmentId\", \"studentId\", \"sectionId\", \"action\", \"actorId\", \"requestHash\")"
                        + " VALUES (:id, :enrollmentId, :studentId, :sectionId, 'ENROLL', :actorId, :hash)",
                new MapSqlParameterSource()
                        .addValue("id", UUID.randomUUID().toString())
                        .addValue("enrollmentId", enrollmentId)
                        .addValue("studentId", studentId)
                        .addValue("sectionId", sectionId)
                        .addValue("actorId", studentId)
                        .addValue("hash", hash));
        completeIdempotency(studentId, idempotencyKey, enrollmentId, hash);
        EnrollmentResponse response = reads.findEnrollment(enrollmentId, roles, studentId);
        // Document/lifecycle side effects belong to the first execution only:
        // a replay must not resurrect a slip that a drop has already retired.
        persistSlip(studentId, response);
        return response;
    }

    /**
     * Replay of a completed enroll claim. A recorded target that still
     * resolves answers with its live row — a dropped enrollment honestly
     * reports DROPPED rather than certifying a stale success. A hard-deleted
     * or never-recorded target answers the stable conflict tombstone the
     * other idempotent services use, instead of a fabricated result or a
     * server error.
     */
    private EnrollmentResponse replayedEnrollment(
            Map<String, Object> replay,
            List<String> roles,
            String studentId) {
        Object recorded = replay.get("enrollment_id");
        String enrollmentId = recorded == null ? null : String.valueOf(recorded).trim();
        if (enrollmentId == null || enrollmentId.isEmpty()) {
            throw replayTombstone();
        }
        try {
            return reads.findEnrollment(enrollmentId, roles, studentId);
        } catch (ResponseStatusException exception) {
            if (HttpStatus.NOT_FOUND.equals(exception.getStatusCode())) {
                throw replayTombstone();
            }
            throw exception;
        }
    }

    private static DomainException replayTombstone() {
        return problem(HttpStatus.CONFLICT, "IDEMPOTENCY_RESPONSE_UNAVAILABLE",
                "The recorded enrollment result is unavailable; query the current enrollment state");
    }

    private void dropLocked(
            String enrollmentId,
            String studentId,
            List<String> roles,
            String idempotencyKey,
            String hash,
            String actorId) {
        Map<String, Object> replay = claimIdempotency(studentId == null ? enrollmentId : studentId, idempotencyKey, hash);
        if (replay != null) {
            return;
        }
        // Resolve the immutable owner and section without locking Enrollment.
        // Every writer in this module takes row locks in one order — Student,
        // then Section, then Enrollment (the order attendance check-in shares);
        // a writer may skip a prefix but must never hold an Enrollment lock
        // while waiting on the owning Section, including administrative drops.
        String targetStudentId;
        String resolvedSectionId;
        try {
            Map<String, Object> resolved = jdbc.queryForMap(
                    "SELECT \"studentId\" AS student_id, \"sectionId\" AS section_id"
                            + " FROM " + ENROLLMENT + " WHERE \"id\" = :id",
                    new MapSqlParameterSource("id", enrollmentId));
            targetStudentId = String.valueOf(resolved.get("student_id"));
            resolvedSectionId = String.valueOf(resolved.get("section_id"));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "ENROLLMENT_NOT_FOUND", "Enrollment not found");
        }
        lockStudent(targetStudentId);
        // Student serializes same-student operations. Across students, Section
        // must precede Round on both enroll and drop to avoid a second lock cycle.
        Map<String, Object> section = lockSection(resolvedSectionId);
        Map<String, Object> enrollment;
        try {
            enrollment = jdbc.queryForMap(
                    "SELECT \"id\", \"studentId\" AS student_id, \"sectionId\" AS section_id, \"semesterId\" AS semester_id,"
                            + " \"status\" FROM " + ENROLLMENT + " WHERE \"id\" = :id FOR UPDATE",
                    new MapSqlParameterSource("id", enrollmentId));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "ENROLLMENT_NOT_FOUND", "Enrollment not found");
        }
        // Authority is re-read under the row lock: the unlocked resolve could
        // not see a concurrent reparenting or delete that committed meanwhile.
        if (!targetStudentId.equals(String.valueOf(enrollment.get("student_id")))
                || !resolvedSectionId.equals(String.valueOf(enrollment.get("section_id")))) {
            throw problem(HttpStatus.CONFLICT, "ENROLLMENT_NOT_ACTIVE", "Enrollment changed during the request");
        }
        boolean admin = roles != null && (roles.contains("ADMIN") || roles.contains("SUPER_ADMIN"));
        if (!admin && !java.util.Objects.equals(studentId, String.valueOf(enrollment.get("student_id")))) {
            throw problem(HttpStatus.FORBIDDEN, "ENROLLMENT_FORBIDDEN", "Enrollment does not belong to the current student");
        }
        if (!List.of("ENROLLED", "PENDING", "CONFIRMED").contains(String.valueOf(enrollment.get("status")))) {
            throw problem(HttpStatus.CONFLICT, "ENROLLMENT_NOT_ACTIVE", "Enrollment is no longer active");
        }
        String droppedCourseId = String.valueOf(section.get("course_id"));
        String semesterId = String.valueOf(enrollment.get("semester_id"));
        assertNoActiveCorequisiteDependents(targetStudentId, droppedCourseId, semesterId, enrollmentId);
        openRoundReadOnly(semesterId, "ADD_DROP");
        jdbc.update(
                "UPDATE " + ENROLLMENT + " SET \"status\" = 'DROPPED', \"droppedAt\" = CURRENT_TIMESTAMP,"
                        + " \"updatedAt\" = CURRENT_TIMESTAMP WHERE \"id\" = :id",
                new MapSqlParameterSource("id", enrollmentId));
        jdbc.update(
                "UPDATE " + SECTION + " SET \"enrolledCount\" = CASE WHEN \"enrolledCount\" > 0 THEN \"enrolledCount\" - 1 ELSE 0 END,"
                        + " \"updatedAt\" = CURRENT_TIMESTAMP WHERE \"id\" = :sectionId",
                new MapSqlParameterSource("sectionId", enrollment.get("section_id")));
        // Persisted slips are snapshots of the active registration set. A drop
        // must invalidate them in the same transaction, otherwise the next slip
        // download keeps claiming the dropped course as a valid enrollment.
        jdbc.update(
                "DELETE FROM " + SLIP + " WHERE \"studentId\" = :studentId AND \"semesterId\" = :semesterId",
                new MapSqlParameterSource()
                        .addValue("studentId", targetStudentId)
                        .addValue("semesterId", String.valueOf(enrollment.get("semester_id"))));
        jdbc.update(
                "INSERT INTO " + EVENT
                        + " (\"id\", \"enrollmentId\", \"studentId\", \"sectionId\", \"action\", \"actorId\", \"requestHash\")"
                        + " VALUES (:id, :enrollmentId, :studentId, :sectionId, 'DROP', :actorId, :hash)",
                new MapSqlParameterSource()
                        .addValue("id", UUID.randomUUID().toString())
                        .addValue("enrollmentId", enrollmentId)
                        .addValue("studentId", targetStudentId)
                        .addValue("sectionId", enrollment.get("section_id"))
                        .addValue("actorId", actorId == null || actorId.isBlank() ? "system" : actorId)
                        .addValue("hash", hash));
        completeIdempotency(studentId == null ? enrollmentId : studentId, idempotencyKey, enrollmentId, hash);
    }

    private void persistSlip(String studentId, EnrollmentResponse response) {
        if (response == null) {
            throw problem(HttpStatus.INTERNAL_SERVER_ERROR, "SLIP_PERSIST_FAILED", "Enrollment response missing after enroll");
        }
        List<Map<String, Object>> active = activeEnrollments(studentId, response.semesterId());
        if (active.isEmpty()) {
            throw problem(HttpStatus.INTERNAL_SERVER_ERROR, "SLIP_PERSIST_FAILED", "Active registration roster is empty after enroll");
        }
        RenderedSlip rendered = renderActiveRoster(studentId, response.semesterId(), active);
        String digest = rendered.sha256();
        jdbc.update(
                "DELETE FROM " + SLIP + " WHERE \"studentId\" = :studentId AND \"semesterId\" = :semesterId",
                new MapSqlParameterSource()
                        .addValue("studentId", studentId)
                        .addValue("semesterId", response.semesterId()));
        int inserted = jdbc.update(
                "INSERT INTO " + SLIP
                        + " (\"id\", \"studentId\", \"semesterId\", \"roundId\", \"sha256\", \"byteSize\", \"payload\")"
                        + " SELECT :id, :studentId, :semesterId, enrollment.\"roundId\", :sha, :size, :payload"
                        + " FROM " + ENROLLMENT + " enrollment WHERE enrollment.\"id\" = :enrollmentId",
                new MapSqlParameterSource()
                        .addValue("id", UUID.randomUUID().toString())
                        .addValue("studentId", studentId)
                        .addValue("semesterId", response.semesterId())
                        .addValue("sha", digest)
                        .addValue("size", rendered.payload().length)
                        .addValue("payload", rendered.payload())
                        .addValue("enrollmentId", response.id()));
        if (inserted != 1) {
            throw problem(HttpStatus.INTERNAL_SERVER_ERROR, "SLIP_PERSIST_FAILED", "Registration slip was not stored");
        }
        jdbc.update(
                "UPDATE " + IDEMPOTENCY + " SET \"slipSha256\" = :sha WHERE \"ownerId\" = :ownerId AND \"enrollmentId\" = :enrollmentId",
                new MapSqlParameterSource()
                        .addValue("sha", digest)
                        .addValue("ownerId", studentId)
                        .addValue("enrollmentId", response.id()));
    }

    private Map<String, Object> claimIdempotency(String ownerId, String key, String hash) {
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("id", UUID.randomUUID().toString())
                .addValue("ownerId", ownerId)
                .addValue("key", key)
                .addValue("hash", hash);
        if (postgres) {
            int inserted = jdbc.update(
                    "INSERT INTO " + IDEMPOTENCY
                            + " (\"id\", \"ownerId\", \"idempotencyKey\", \"requestHash\", \"state\")"
                            + " VALUES (:id, :ownerId, :key, :hash, 'IN_PROGRESS')"
                            + " ON CONFLICT (\"ownerId\", \"idempotencyKey\") DO NOTHING",
                    parameters);
            if (inserted == 1) {
                return null;
            }
        } else {
            try {
                jdbc.update(
                        "INSERT INTO " + IDEMPOTENCY
                                + " (\"id\", \"ownerId\", \"idempotencyKey\", \"requestHash\", \"state\")"
                                + " VALUES (:id, :ownerId, :key, :hash, 'IN_PROGRESS')",
                        parameters);
                return null;
            } catch (DataIntegrityViolationException duplicate) {
                // H2 does not implement PostgreSQL's ON CONFLICT syntax. This
                // fallback is test-only; production PostgreSQL never aborts the
                // surrounding transaction on the duplicate-key path.
            }
        }
        Map<String, Object> existing = jdbc.queryForMap(
                "SELECT \"requestHash\" AS request_hash, \"state\", \"enrollmentId\" AS enrollment_id"
                        + " FROM " + IDEMPOTENCY + " WHERE \"ownerId\" = :ownerId AND \"idempotencyKey\" = :key",
                new MapSqlParameterSource().addValue("ownerId", ownerId).addValue("key", key));
        if (!hash.equals(String.valueOf(existing.get("request_hash")).trim())) {
            throw problem(HttpStatus.CONFLICT, "IDEMPOTENCY_CONFLICT", "Idempotency key was reused with a different payload");
        }
        if ("IN_PROGRESS".equals(String.valueOf(existing.get("state")))) {
            throw problem(HttpStatus.CONFLICT, "IDEMPOTENCY_IN_PROGRESS", "The same request is already in progress");
        }
        return existing;
    }

    private void completeIdempotency(String ownerId, String key, String enrollmentId, String hash) {
        jdbc.update(
                "UPDATE " + IDEMPOTENCY
                        + " SET \"state\" = 'COMPLETED', \"enrollmentId\" = :enrollmentId, \"requestHash\" = :hash,"
                        + " \"updatedAt\" = CURRENT_TIMESTAMP WHERE \"ownerId\" = :ownerId AND \"idempotencyKey\" = :key",
                new MapSqlParameterSource()
                        .addValue("enrollmentId", enrollmentId)
                        .addValue("hash", hash)
                        .addValue("ownerId", ownerId)
                        .addValue("key", key));
    }

    private void requireKey(String idempotencyKey) {
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            throw problem(HttpStatus.BAD_REQUEST, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required");
        }
        if (idempotencyKey.length() > 200) {
            throw problem(HttpStatus.BAD_REQUEST, "IDEMPOTENCY_KEY_INVALID",
                    "Idempotency-Key must not exceed 200 characters");
        }
    }

    private Map<String, Object> requireStudent(String studentId) {
        try {
            Map<String, Object> student = jdbc.queryForMap(
                    "SELECT \"id\", \"curriculumId\" AS curriculum_id, \"year\", \"status\" FROM " + STUDENT
                            + " WHERE \"id\" = :id",
                    new MapSqlParameterSource("id", studentId));
            if (!"ACTIVE".equals(String.valueOf(student.get("status")))) {
                throw problem(HttpStatus.FORBIDDEN, "STUDENT_PROFILE_REQUIRED", "Student profile is not active");
            }
            return student;
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.FORBIDDEN, "STUDENT_PROFILE_REQUIRED", "Student profile is required");
        }
    }

    private Map<String, Object> lockStudent(String studentId) {
        try {
            Map<String, Object> student = jdbc.queryForMap(
                    "SELECT \"id\", \"curriculumId\" AS curriculum_id, \"year\", \"status\" FROM " + STUDENT
                            + " WHERE \"id\" = :id FOR UPDATE",
                    new MapSqlParameterSource("id", studentId));
            if (!"ACTIVE".equals(String.valueOf(student.get("status")))) {
                throw problem(HttpStatus.FORBIDDEN, "STUDENT_PROFILE_REQUIRED", "Student profile is not active");
            }
            return student;
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.FORBIDDEN, "STUDENT_PROFILE_REQUIRED", "Student profile is required");
        }
    }

    private Map<String, Object> lockSection(String sectionId) {
        try {
            return jdbc.queryForMap(
                    "SELECT section.\"id\", section.\"status\", section.\"capacity\", section.\"enrolledCount\" AS enrolled_count,"
                            + " section.\"semesterId\" AS semester_id, section.\"courseId\" AS course_id, course.\"credits\" AS credits"
                            + " FROM " + SECTION + " section JOIN " + COURSE + " course ON course.\"id\" = section.\"courseId\""
                            + " WHERE section.\"id\" = :id FOR UPDATE",
                    new MapSqlParameterSource("id", sectionId));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "SECTION_NOT_FOUND", "Section not found");
        }
    }

    private Map<String, Object> openRound(String semesterId, String preferredKind) {
        return openRound(semesterId, preferredKind, true);
    }

    /** Read paths must not hold exclusive round locks; only enroll/drop serialize on them. */
    private Map<String, Object> openRoundReadOnly(String semesterId, String preferredKind) {
        return openRound(semesterId, preferredKind, false);
    }

    /**
     * Reads the active round for catalog, eligibility, and summary screens.
     * Catalog and summary remain available during an open add/drop window after
     * the initial registration window has closed; mutation paths keep their
     * stricter phase-specific locks below.
     */
    private Map<String, Object> openReadRound(String semesterId) {
        try {
            return openRoundReadOnly(semesterId, "REGISTRATION");
        } catch (DomainException exception) {
            if (!"WINDOW_CLOSED".equals(exception.code())) {
                throw exception;
            }
            return openRoundReadOnly(semesterId, "ADD_DROP");
        }
    }

    private Map<String, Object> openRound(String semesterId, String preferredKind, boolean forUpdate) {
        MapSqlParameterSource parameters = new MapSqlParameterSource();
        String sql = "SELECT \"id\", \"semesterId\" AS semester_id, \"kind\", \"status\", \"windowStart\" AS window_start,"
                + " \"windowEnd\" AS window_end, \"creditLimit\" AS credit_limit FROM " + ROUND
                + " WHERE \"status\" = 'OPEN'";
        if (semesterId != null && !semesterId.isBlank()) {
            sql += " AND \"semesterId\" = :semesterId";
            parameters.addValue("semesterId", semesterId);
        }
        sql += " ORDER BY \"windowStart\"" + (forUpdate ? " FOR UPDATE" : "");
        List<Map<String, Object>> rounds = jdbc.queryForList(sql, parameters);
        Instant now = Instant.now();
        Map<String, Object> preferred = rounds.stream()
                .filter(row -> preferredKind.equals(String.valueOf(row.get("kind"))))
                .filter(row -> inWindow(row, now))
                .findFirst()
                .orElse(null);
        if (preferred != null) {
            return preferred;
        }
        // The two round kinds are interchangeable for reads, and each write
        // path must keep working while the other window is the only one open:
        // drops fall back to a live REGISTRATION round, and enrollments fall
        // back to a live ADD_DROP round (its seeded name is literally
        // "supplementary registration + drop" — adds are its purpose, so
        // blocking them between the registration deadline and the add/drop
        // deadline left students unable to add courses for days).
        String fallbackKind = "ADD_DROP".equals(preferredKind) ? "REGISTRATION" : "ADD_DROP";
        Map<String, Object> fallback = rounds.stream()
                .filter(row -> fallbackKind.equals(String.valueOf(row.get("kind"))))
                .filter(row -> inWindow(row, now))
                .findFirst()
                .orElse(null);
        if (fallback != null) {
            return fallback;
        }
        throw problem(HttpStatus.CONFLICT, "WINDOW_CLOSED", "No open registration window");
    }

    private Map<String, Object> round(String roundId) {
        try {
            return jdbc.queryForMap(
                    "SELECT \"id\", \"semesterId\" AS semester_id, \"kind\", \"status\", \"windowStart\" AS window_start,"
                            + " \"windowEnd\" AS window_end, \"creditLimit\" AS credit_limit FROM " + ROUND
                            + " WHERE \"id\" = :id",
                    new MapSqlParameterSource("id", roundId));
        } catch (EmptyResultDataAccessException exception) {
            throw problem(HttpStatus.NOT_FOUND, "ROUND_NOT_FOUND", "Registration round not found");
        }
    }

    private void assertEligible(Map<String, Object> student, Map<String, Object> round, Instant now) {
        if (!"OPEN".equals(String.valueOf(round.get("status"))) || !inWindow(round, now)) {
            throw problem(HttpStatus.CONFLICT, "WINDOW_CLOSED", "Registration window is closed");
        }
        // One query answers both "does this round restrict cohorts" and "does
        // the student match one": counting the two populations in a single
        // round trip keeps the catalog query budget contract at a constant.
        Map<String, Object> counts = jdbc.queryForMap(
                "SELECT COUNT(*) AS total,"
                        + " SUM(CASE WHEN (\"curriculumId\" IS NULL OR \"curriculumId\" = :curriculumId)"
                        + " AND (\"year\" IS NULL OR \"year\" = :year) THEN 1 ELSE 0 END) AS matched"
                        + " FROM " + COHORT + " WHERE \"roundId\" = :roundId",
                new MapSqlParameterSource()
                        .addValue("roundId", round.get("id"))
                        .addValue("curriculumId", student.get("curriculum_id"))
                        .addValue("year", student.get("year")));
        long total = counts.get("total") == null ? 0 : ((Number) counts.get("total")).longValue();
        if (total == 0) {
            return;
        }
        long matched = counts.get("matched") == null ? 0 : ((Number) counts.get("matched")).longValue();
        if (matched == 0) {
            throw problem(HttpStatus.UNPROCESSABLE_ENTITY, "COHORT_INELIGIBLE", "Student is outside this registration cohort");
        }
    }

    private boolean inWindow(Map<String, Object> round, Instant now) {
        Instant start = timestamp((Timestamp) round.get("window_start"));
        Instant end = timestamp((Timestamp) round.get("window_end"));
        return start != null && end != null && !now.isBefore(start) && !now.isAfter(end);
    }

    private List<Map<String, Object>> activeEnrollments(String studentId, String semesterId) {
        // Credits come from the CURRENT section -> course definition, not the
        // enrollment snapshot: a snapshot raised after registration would
        // under-count the 30-credit cap on both the read and write paths.
        return jdbc.queryForList(
                "SELECT enrollment.\"id\", enrollment.\"sectionId\" AS section_id, enrollment.\"courseId\" AS course_id,"
                        + " enrollment.\"roundId\" AS round_id, course.\"credits\" AS credits,"
                        + " course.\"code\" AS course_code, course.\"name\" AS course_name, section.\"sectionNumber\" AS section_number"
                        + " FROM " + ENROLLMENT + " enrollment"
                        + " JOIN " + SECTION + " section ON section.\"id\" = enrollment.\"sectionId\""
                        + " JOIN " + COURSE + " course ON course.\"id\" = section.\"courseId\""
                        + " WHERE enrollment.\"studentId\" = :studentId AND enrollment.\"semesterId\" = :semesterId"
                        + " AND enrollment.\"status\" IN ('ENROLLED', 'PENDING', 'CONFIRMED')"
                        + " ORDER BY course.\"code\", section.\"sectionNumber\"",
                new MapSqlParameterSource().addValue("studentId", studentId).addValue("semesterId", semesterId));
    }

    private List<Map<String, Object>> completedEnrollmentsForSlip(String studentId, String semesterId) {
        return jdbc.queryForList(
                "SELECT enrollment.\"id\", enrollment.\"sectionId\" AS section_id, enrollment.\"courseId\" AS course_id,"
                        + " enrollment.\"roundId\" AS round_id, course.\"credits\" AS credits,"
                        + " course.\"code\" AS course_code, course.\"name\" AS course_name, section.\"sectionNumber\" AS section_number"
                        + " FROM " + ENROLLMENT + " enrollment"
                        + " JOIN " + SECTION + " section ON section.\"id\" = enrollment.\"sectionId\""
                        + " JOIN " + COURSE + " course ON course.\"id\" = section.\"courseId\""
                        + " WHERE enrollment.\"studentId\" = :studentId AND enrollment.\"semesterId\" = :semesterId"
                        + " AND enrollment.\"status\" = 'COMPLETED'"
                        + " ORDER BY course.\"code\", section.\"sectionNumber\"",
                new MapSqlParameterSource().addValue("studentId", studentId).addValue("semesterId", semesterId));
    }

    private List<Map<String, Object>> lockActiveEnrollments(String studentId, String semesterId) {
        return jdbc.queryForList(
                "SELECT enrollment.\"id\", enrollment.\"sectionId\" AS section_id, enrollment.\"courseId\" AS course_id,"
                        + " course.\"credits\" AS credits FROM " + ENROLLMENT + " enrollment"
                        + " JOIN " + SECTION + " section ON section.\"id\" = enrollment.\"sectionId\""
                        + " JOIN " + COURSE + " course ON course.\"id\" = section.\"courseId\""
                        + " WHERE enrollment.\"studentId\" = :studentId AND enrollment.\"semesterId\" = :semesterId"
                        + " AND enrollment.\"status\" IN ('ENROLLED', 'PENDING', 'CONFIRMED')"
                        // Multi-row locks are taken in a fixed id order so two
                        // overlapping sets cannot contend in opposite orders.
                        + " ORDER BY enrollment.\"id\""
                        // PostgreSQL otherwise locks the joined Section/Course rows too,
                        // inverting Section -> Round for a different student's drop.
                        + (postgres ? " FOR UPDATE OF enrollment" : " FOR UPDATE"),
                new MapSqlParameterSource().addValue("studentId", studentId).addValue("semesterId", semesterId));
    }

    /**
     * Quota counts the CURRENT credits of each enrolled section (section →
     * course), not the snapshot taken at enroll time: when a course's credits
     * are raised after a student registered, the stale snapshot under-counts
     * the 30-credit cap and lets the student register past the limit.
     */
    private int creditsUsed(String studentId, String semesterId) {
        Integer used = jdbc.queryForObject(
                "SELECT COALESCE(SUM(course.\"credits\"), 0) FROM " + ENROLLMENT + " enrollment"
                        + " JOIN " + SECTION + " section ON section.\"id\" = enrollment.\"sectionId\""
                        + " JOIN " + COURSE + " course ON course.\"id\" = section.\"courseId\""
                        + " WHERE enrollment.\"studentId\" = :studentId AND enrollment.\"semesterId\" = :semesterId"
                        + " AND enrollment.\"status\" IN ('ENROLLED', 'PENDING', 'CONFIRMED')",
                new MapSqlParameterSource().addValue("studentId", studentId).addValue("semesterId", semesterId),
                Integer.class);
        return used == null ? 0 : used;
    }

    private void assertPrereqAndCoreq(String studentId, String courseId, String semesterId, List<String> requestSectionIds) {
        List<Map<String, Object>> requirements = jdbc.queryForList(
                "SELECT \"requiredCourseId\" AS required_course_id, \"kind\", \"minLetterGrade\" AS min_letter_grade"
                        + " FROM " + REQUIREMENT + " WHERE \"courseId\" = :courseId",
                new MapSqlParameterSource("courseId", courseId));
        if (requirements.isEmpty()) {
            return;
        }
        List<String> prerequisiteCourseIds = requirements.stream()
                .filter(requirement -> "PREREQ".equals(String.valueOf(requirement.get("kind"))))
                .map(requirement -> String.valueOf(requirement.get("required_course_id")))
                .distinct()
                .toList();
        List<String> corequisiteCourseIds = requirements.stream()
                .filter(requirement -> "COREQ".equals(String.valueOf(requirement.get("kind"))))
                .map(requirement -> String.valueOf(requirement.get("required_course_id")))
                .distinct()
                .toList();
        // Corequisites are also satisfied by a prior-term completion, not only
        // by a concurrent enrollment or the current request cart.
        List<String> completedCourseIds = new ArrayList<>(prerequisiteCourseIds);
        for (String course : corequisiteCourseIds) {
            if (!completedCourseIds.contains(course)) {
                completedCourseIds.add(course);
            }
        }
        Map<String, List<String>> completedLetters = completedCourseIds.isEmpty()
                ? Map.of()
                : completedLetters(studentId, completedCourseIds);
        Set<String> activeCorequisites = corequisiteCourseIds.isEmpty()
                ? Set.of()
                : activeCourseIds(studentId, semesterId, corequisiteCourseIds);
        Set<String> requestedCourses = corequisiteCourseIds.isEmpty()
                ? Set.of()
                : courseIdsOfSections(requestSectionIds);
        for (Map<String, Object> requirement : requirements) {
            String required = String.valueOf(requirement.get("required_course_id"));
            String kind = String.valueOf(requirement.get("kind"));
            String minLetter = requirement.get("min_letter_grade") == null
                    ? null : String.valueOf(requirement.get("min_letter_grade"));
            if ("PREREQ".equals(kind)
                    && !satisfiesLetterFloor(completedLetters.getOrDefault(required, List.of()), minLetter)) {
                throw problem(HttpStatus.UNPROCESSABLE_ENTITY, "PREREQUISITE_UNMET", "A required prerequisite is missing");
            }
            if ("COREQ".equals(kind)
                    && !completedLetters.containsKey(required)
                    && !activeCorequisites.contains(required)
                    && !requestedCourses.contains(required)) {
                throw problem(HttpStatus.UNPROCESSABLE_ENTITY, "COREQUISITE_UNMET", "A required corequisite is missing");
            }
        }
    }

    private void assertNoActiveCorequisiteDependents(
            String studentId,
            String droppedCourseId,
            String semesterId,
            String droppedEnrollmentId) {
        List<String> otherActiveCourseIds = activeEnrollments(studentId, semesterId).stream()
                .filter(row -> !droppedEnrollmentId.equals(String.valueOf(row.get("id"))))
                .map(row -> String.valueOf(row.get("course_id")))
                .distinct()
                .toList();
        if (otherActiveCourseIds.isEmpty()) {
            return;
        }
        List<String> dependentCourses = jdbc.queryForList(
                "SELECT \"courseId\" FROM " + REQUIREMENT
                        + " WHERE \"courseId\" IN (:courseIds) AND \"requiredCourseId\" = :requiredId AND \"kind\" = 'COREQ'",
                new MapSqlParameterSource()
                        .addValue("courseIds", otherActiveCourseIds)
                        .addValue("requiredId", droppedCourseId),
                String.class);
        if (!dependentCourses.isEmpty()) {
            throw problem(HttpStatus.CONFLICT, "COREQUISITE_UNMET",
                    "Cannot drop course because it is a corequisite for another active course this semester");
        }
    }

    /** Letter ordering used for prerequisite minimum-grade enforcement. */
    private static final java.util.Map<String, Integer> LETTER_RANK = java.util.Map.ofEntries(
            java.util.Map.entry("F", 0),
            java.util.Map.entry("D-", 1),
            java.util.Map.entry("D", 2),
            java.util.Map.entry("D+", 3),
            java.util.Map.entry("C-", 4),
            java.util.Map.entry("C", 5),
            java.util.Map.entry("C+", 6),
            java.util.Map.entry("B-", 7),
            java.util.Map.entry("B", 8),
            java.util.Map.entry("B+", 9),
            java.util.Map.entry("A-", 10),
            java.util.Map.entry("A", 11),
            java.util.Map.entry("A+", 12));

    /** A malformed floor should not be able to widen a requirement repeatedly. */
    private static final Set<String> WARNED_UNKNOWN_FLOORS = java.util.concurrent.ConcurrentHashMap.newKeySet();

    private boolean hasCompleted(String studentId, String courseId, String minLetter) {
        return satisfiesLetterFloor(
                completedLetters(studentId, List.of(courseId)).getOrDefault(courseId, List.of()), minLetter);
    }

    /** Passing letters of one course set, grouped in one statement. */
    private Map<String, List<String>> completedLetters(String studentId, List<String> courseIds) {
        Map<String, List<String>> letters = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbc.queryForList(
                "SELECT \"courseId\" AS course_id, \"letterGrade\" AS letter_grade FROM " + ENROLLMENT
                        + " WHERE \"studentId\" = :studentId AND \"courseId\" IN (:courseIds)"
                        + " AND (\"gradeStatus\" IN ('PUBLISHED', 'APPEALED') OR \"status\" = 'COMPLETED')"
                        // A passing letter is required: a graded row without a
                        // letter (a producer bug) must never silently unlock a
                        // prerequisite, matching the knowledge-base copy.
                        + " AND \"letterGrade\" IS NOT NULL"
                        + " AND \"letterGrade\" NOT IN ('F', 'W')",
                new MapSqlParameterSource()
                        .addValue("studentId", studentId)
                        .addValue("courseIds", courseIds))) {
            letters.computeIfAbsent(String.valueOf(row.get("course_id")), key -> new ArrayList<>())
                    .add(String.valueOf(row.get("letter_grade")));
        }
        return letters;
    }

    /**
     * DSJ-06: a declared floor is enforced against the best passing attempt.
     * The rank table carries the legacy minus bands (the 10-point bands never
     * emit them, but transcripts and imported records do). A non-null floor
     * that is not a known letter is a malformed requirement, so it fails
     * closed instead of degrading into "no floor".
     */
    static boolean satisfiesLetterFloor(List<String> letters, String minLetter) {
        Integer minimum = null;
        if (minLetter != null) {
            String normalizedFloor = minLetter.trim().toUpperCase(Locale.ROOT);
            minimum = LETTER_RANK.get(normalizedFloor);
            if (minimum == null) {
                if (WARNED_UNKNOWN_FLOORS.add(normalizedFloor)) {
                    log.warn("Unknown prerequisite minLetterGrade '{}'; failing the prerequisite closed",
                            normalizedFloor);
                }
                return false;
            }
        }
        for (String letter : letters) {
            if (letter == null) {
                continue;
            }
            String normalized = letter.trim().toUpperCase(Locale.ROOT);
            // F and W are never passing grades, even when no floor is declared.
            if ("F".equals(normalized) || "W".equals(normalized)) {
                continue;
            }
            Integer rank = LETTER_RANK.get(normalized);
            if (rank != null && (minimum == null || rank >= minimum)) {
                return true;
            }
        }
        return false;
    }

    private Set<String> activeCourseIds(String studentId, String semesterId, List<String> courseIds) {
        return new LinkedHashSet<>(jdbc.queryForList(
                "SELECT DISTINCT \"courseId\" FROM " + ENROLLMENT
                        + " WHERE \"studentId\" = :studentId AND \"semesterId\" = :semesterId"
                        + " AND \"courseId\" IN (:courseIds)"
                        + " AND \"status\" IN ('ENROLLED', 'PENDING', 'CONFIRMED')",
                new MapSqlParameterSource()
                        .addValue("studentId", studentId)
                        .addValue("semesterId", semesterId)
                        .addValue("courseIds", courseIds),
                String.class));
    }

    private Set<String> courseIdsOfSections(List<String> sectionIds) {
        if (sectionIds.isEmpty()) {
            return Set.of();
        }
        return new LinkedHashSet<>(jdbc.queryForList(
                "SELECT DISTINCT \"courseId\" FROM " + SECTION + " WHERE \"id\" IN (:ids)",
                new MapSqlParameterSource("ids", sectionIds),
                String.class));
    }

    private List<TimeRange> schedulesForSection(String sectionId) {
        return schedulesForSections(List.of(sectionId));
    }

    private List<TimeRange> schedulesForSections(List<String> sectionIds) {
        if (sectionIds.isEmpty()) {
            return List.of();
        }
        return jdbc.query(
                "SELECT \"dayOfWeek\" AS day_of_week, \"startTime\" AS start_time, \"endTime\" AS end_time FROM "
                        + SCHEDULE + " WHERE \"sectionId\" IN (:ids)",
                new MapSqlParameterSource("ids", sectionIds),
                (rs, rowNum) -> new TimeRange(rs.getInt("day_of_week"), rs.getString("start_time"), rs.getString("end_time")));
    }

    private boolean overlaps(List<TimeRange> left, List<TimeRange> right) {
        for (TimeRange first : left) {
            for (TimeRange second : right) {
                if (first.day == second.day
                        && first.start.compareTo(second.end) < 0
                        && second.start.compareTo(first.end) < 0) {
                    return true;
                }
            }
        }
        return false;
    }

    private static Instant timestamp(Timestamp value) {
        return value == null ? null : value.toInstant();
    }

    private static String sha256(String value) {
        return sha256(value.getBytes(StandardCharsets.UTF_8));
    }

    private static String sha256(byte[] value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }

    private static byte[] payloadBytes(Object payload) {
        if (payload instanceof byte[] bytes) {
            return bytes;
        }
        if (payload instanceof java.sql.Blob blob) {
            try {
                return blob.getBytes(1, (int) blob.length());
            } catch (java.sql.SQLException exception) {
                throw problem(HttpStatus.INTERNAL_SERVER_ERROR, "SLIP_PERSIST_FAILED", "Registration slip could not be read");
            }
        }
        throw problem(HttpStatus.INTERNAL_SERVER_ERROR, "SLIP_PERSIST_FAILED", "Registration slip payload is missing");
    }

    private static DomainException problem(HttpStatus status, String code, String message) {
        return new DomainException(status, code, message);
    }

    private record TimeRange(int day, String start, String end) {
    }

    /** One fan-out row of the catalog query: section columns + optional schedule + relevance. */
    private record CatalogRow(
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
            String status,
            TimeRange schedule,
            String room,
            String lecturer,
            CurriculumRelevance relevance,
            String departmentId,
            String departmentCode,
            String departmentName) {
    }

    private static String displayName(String firstName, String lastName) {
        // Vietnamese order: lastName carries the surname + title, firstName the
        // given name, so "TS. Phạm Thị" + "Ngọc Lan" renders "TS. Phạm Thị Ngọc Lan".
        String name = ((lastName == null ? "" : lastName.trim()) + " " + (firstName == null ? "" : firstName.trim())).trim();
        return name.isEmpty() ? null : name;
    }
}
