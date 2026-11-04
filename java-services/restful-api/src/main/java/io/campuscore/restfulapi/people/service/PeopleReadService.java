package io.campuscore.restfulapi.people.service;

import io.campuscore.restfulapi.common.LikePattern;
import io.campuscore.restfulapi.people.repository.PeopleReadRepository;
import io.campuscore.restfulapi.people.web.PeopleReadDtos.LecturerListResponse;
import io.campuscore.restfulapi.people.web.PeopleReadDtos.LecturerResponse;
import io.campuscore.restfulapi.people.web.PeopleReadDtos.PageMeta;
import io.campuscore.restfulapi.people.web.PeopleReadDtos.StudentListResponse;
import io.campuscore.restfulapi.people.web.PeopleReadDtos.StudentResponse;
import java.util.List;
import java.util.Set;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Student and lecturer profile query service. */
@Service
@Profile("persistence")
public class PeopleReadService {

    public static final int MAX_PAGE_SIZE = 100;

    private final PeopleReadRepository people;

    public PeopleReadService(PeopleReadRepository people) {
        this.people = people;
    }

    @Transactional(readOnly = true)
    public StudentListResponse findStudents(int page, int limit, String status) {
        return findStudents(page, limit, status, null);
    }

    /**
     * Lecturer-scoped directory listing: ADMIN/SUPER_ADMIN see everyone;
     * a lecturer sees only students enrolled in their visibility tier
     * (own sections, department courses for TRUONG_BO_MON, faculty courses
     * for TRUONG_KHOA). Callers without a lecturer identity see nothing.
     */
    public StudentListResponse findStudents(int page, int limit, String status, Authentication authentication) {
        requirePage(page, limit);
        String normalizedStatus = normalizeStatus(status);
        long total = people.countStudents(normalizedStatus,
                rolesOf(authentication), lecturerIdOf(authentication));
        List<StudentResponse> data = people.findStudents(offset(page, limit), limit, normalizedStatus,
                rolesOf(authentication), lecturerIdOf(authentication));
        return new StudentListResponse(data, meta(total, page, limit));
    }

    /**
     * Roster used by the announcement fan-out: the auth-account id of every
     * ACTIVE student. Deliberately not paginated — the campus population is
     * small (hundreds), and a partial roster would silently skip students.
     */
    @Transactional(readOnly = true)
    public List<String> findActiveStudentUserIds() {
        return people.findActiveStudentUserIds();
    }
    @Transactional(readOnly = true)
    public List<String> findActiveStudentUserIdsInYears(List<Integer> years) {
        return people.findActiveStudentUserIdsInYears(years);
    }

    @Transactional(readOnly = true)
    public List<String> findAnnouncementStudentUserIds(List<Integer> years, String sectionId,
            List<String> targetRoles, String lecturerId) {
        return people.findAnnouncementStudentUserIds(years, sectionId, targetRoles, lecturerId);
    }

    @Transactional(readOnly = true)
    public StudentResponse findStudent(String id) {
        return findStudent(id, null);
    }

    @Transactional(readOnly = true)
    public StudentResponse findStudent(String id, Authentication authentication) {
        String ownerId = studentOnly(authentication) ? authentication.getName() : null;
        if (ownerId != null) {
            return people.findStudentByIdAndUserId(id, ownerId)
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Student not found"));
        }
        StudentResponse student = people.findStudentById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Student not found"));
        if (authentication != null && !studentOnly(authentication)
                && !people.studentVisibleToLecturer(student.id(), rolesOf(authentication), lecturerIdOf(authentication))) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Student not found");
        }
        return student;
    }

    private static List<String> rolesOf(Authentication authentication) {
        if (authentication == null) {
            return java.util.List.of("ADMIN");
        }
        return authentication.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .map(authority -> authority.startsWith("ROLE_") ? authority.substring(5) : authority)
                .toList();
    }

    private static String lecturerIdOf(Authentication authentication) {
        if (authentication == null) {
            return null;
        }
        if (authentication.getPrincipal()
                instanceof org.springframework.security.oauth2.jwt.Jwt jwt) {
            return jwt.getClaimAsString("lecturerId");
        }
        if (authentication.getCredentials()
                instanceof org.springframework.security.oauth2.jwt.Jwt jwtCredentials) {
            return jwtCredentials.getClaimAsString("lecturerId");
        }
        if (authentication.getPrincipal()
                instanceof org.springframework.security.oauth2.core.OAuth2AuthenticatedPrincipal principal) {
            return principal.getAttribute("lecturerId");
        }
        return null;
    }

    private static boolean studentOnly(Authentication authentication) {
        if (authentication == null) {
            return false;
        }
        Set<String> authorities = authentication.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .collect(java.util.stream.Collectors.toSet());
        return (authorities.contains("ROLE_STUDENT") || authorities.isEmpty())
                && !authorities.contains("ROLE_ADMIN")
                && !authorities.contains("ROLE_SUPER_ADMIN")
                && !authorities.contains("ROLE_LECTURER");
    }

    @Transactional(readOnly = true)
    public LecturerListResponse findLecturers(int page, int limit, String search) {
        requirePage(page, limit);
        String pattern = LikePattern.contains(search);
        long total = people.countLecturers(pattern);
        List<LecturerResponse> data = people.findLecturers(offset(page, limit), limit, pattern);
        return new LecturerListResponse(data, meta(total, page, limit));
    }

    @Transactional(readOnly = true)
    public LecturerResponse findLecturer(String id) {
        return findLecturer(id, null);
    }

    @Transactional(readOnly = true)
    public LecturerResponse findLecturer(String id, Authentication authentication) {
        if (!staffOnly(authentication)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Lecturer directory access is required");
        }
        return people.findLecturerById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Lecturer not found"));
    }

    private static boolean staffOnly(Authentication authentication) {
        // Fail closed: an absent authentication must never widen access, even
        // though the controller annotations currently guarantee one.
        if (authentication == null) {
            return false;
        }
        Set<String> authorities = authentication.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .collect(java.util.stream.Collectors.toSet());
        return authorities.contains("ROLE_LECTURER")
                || authorities.contains("ROLE_ADMIN")
                || authorities.contains("ROLE_SUPER_ADMIN");
    }

    /**
     * The academic-affairs statuses that actually exist in the data (the
     * schema default, and the only value every seed writes). Anything else was
     * previously accepted silently and filtered to an always-empty result, so
     * an unknown token is now a client error instead of a lie-by-empty-page.
     */
    public static final Set<String> STUDENT_STATUSES = Set.of("ACTIVE");

    private static String normalizeStatus(String status) {
        if (status == null) {
            return null;
        }
        String trimmed = status.trim();
        if (trimmed.isEmpty()) {
            throw new IllegalArgumentException("status must not be blank");
        }
        String canonical = trimmed.toUpperCase(java.util.Locale.ROOT);
        if (!STUDENT_STATUSES.contains(canonical)) {
            throw new IllegalArgumentException(
                    "Unknown student status: " + status + " (allowed: " + String.join(", ", STUDENT_STATUSES) + ")");
        }
        return canonical;
    }

    private static PageMeta meta(long total, int page, int limit) {
        long totalPages = total == 0 ? 0 : ((total - 1) / limit) + 1;
        if (totalPages > Integer.MAX_VALUE) {
            throw new IllegalArgumentException("People result is too large");
        }
        return new PageMeta(total, page, limit, (int) totalPages);
    }

    private static long offset(int page, int limit) {
        return (long) (page - 1) * limit;
    }

    private static void requirePage(int page, int limit) {
        if (page < 1) {
            throw new IllegalArgumentException("page must be at least 1");
        }
        if (limit < 1 || limit > MAX_PAGE_SIZE) {
            throw new IllegalArgumentException("limit must be between 1 and " + MAX_PAGE_SIZE);
        }
    }
}
