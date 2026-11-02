package io.campuscore.restfulapi.thesis.service;

import io.campuscore.restfulapi.events.web.ListPaging;
import io.campuscore.restfulapi.thesis.domain.ThesisTopic;
import io.campuscore.restfulapi.thesis.domain.TopicStatus;
import io.campuscore.restfulapi.thesis.repository.ThesisRoundReadPort;
import io.campuscore.restfulapi.thesis.repository.ThesisTopicReadRepository;
import io.campuscore.restfulapi.thesis.repository.ThesisTopicRepository;
import io.campuscore.restfulapi.thesis.search.ThesisTopicCatalogSearch;
import io.campuscore.restfulapi.thesis.web.ThesisTopicDtos.TopicResponse;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Profile;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

@Service
@Profile("persistence")
public class ThesisTopicService {

    private final ThesisTopicRepository topics;
    private final ThesisRoundReadPort rounds;
    private final org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate jdbc;
    private final ThesisTopicReadRepository reads;

    /** Test/compatibility constructor: keeps the legacy JPA-only path usable. */
    public ThesisTopicService(ThesisTopicRepository topics, ThesisRoundReadPort rounds,
            org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate jdbc) {
        this(topics, rounds, jdbc, new ThesisTopicReadRepository(jdbc));
    }

    @Autowired
    public ThesisTopicService(ThesisTopicRepository topics, ThesisRoundReadPort rounds,
            org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate jdbc,
            ThesisTopicReadRepository reads) {
        this.topics = topics;
        this.rounds = rounds;
        this.jdbc = jdbc;
        this.reads = reads;
    }

    /**
     * Non-published topics are only visible to their owner (and admins):
     * students never receive DRAFT/ARCHIVED listings, and a lecturer only
     * sees their own proposals, never another supervisor's drafts.
     */
    @Transactional(readOnly = true)
    public List<TopicResponse> list(UUID roundId, TopicStatus status, Jwt actor) {
        return list(roundId, status, actor, null);
    }

    /**
     * Legacy unpaged read plus the optional catalogue filter. The filter runs
     * over the already authorised list, so it can only remove rows; ordering,
     * masking and the empty-parameter behaviour stay untouched.
     */
    @Transactional(readOnly = true)
    public List<TopicResponse> list(UUID roundId, TopicStatus status, Jwt actor, String search) {
        rounds.requireExisting(roundId);
        TopicStatus requestedStatus = status == null ? TopicStatus.PUBLISHED : status;
        List<ThesisTopic> result;
        if (requestedStatus == TopicStatus.PUBLISHED || requestedStatus == TopicStatus.APPROVED
                || isAdmin(actor) || ThesisDeanScope.isFacultyHead(actor)) {
            if (requestedStatus == TopicStatus.PUBLISHED) {
                List<ThesisTopic> published = topics.findAllByRoundIdAndStatusOrderByTitle(roundId, TopicStatus.PUBLISHED);
                List<ThesisTopic> approved = topics.findAllByRoundIdAndStatusOrderByTitle(roundId, TopicStatus.APPROVED);
                result = new java.util.ArrayList<>(published);
                result.addAll(approved);
                result.sort(java.util.Comparator.comparing(ThesisTopic::getTitle));
            } else {
                result = topics.findAllByRoundIdAndStatusOrderByTitle(roundId, requestedStatus);
            }
        } else if (ThesisDepartmentScope.isDepartmentHead(actor)) {
            result = topics.findAllByRoundIdAndStatusOrderByTitle(roundId, requestedStatus);
        } else if (!isLecturer(actor)) {
            result = List.of();
        } else {
            String actorId = subject(actor);
            result = topics.findAllByRoundIdAndStatusOrderByTitle(roundId, requestedStatus)
                    .stream()
                    .filter(topic -> topic.getCreatedBy().equals(actorId))
                    .toList();
        }
        // Faculty and department governance queues follow the caller's live active profile.
        Set<String> deanFacultyDepts = Set.of();
        Set<UUID> deanSupervisedIds = Set.of();
        if (!isAdmin(actor) && ThesisDeanScope.isFacultyHead(actor)) {
            String facultyId = ThesisDeanScope.facultyId(jdbc, actor);
            deanFacultyDepts = facultyDepartmentIds(facultyId);
            String deanLecturerId = normalize(actor == null ? null : actor.getClaimAsString("lecturerId"));
            deanSupervisedIds = deanLecturerId.isEmpty() || result.isEmpty()
                    ? Set.of()
                    : new HashSet<>(supervisedTopicIds(deanLecturerId,
                            result.stream().map(ThesisTopic::getId).toList()));
            Set<String> inFacultyDepts = deanFacultyDepts;
            Set<UUID> supervisedByDean = deanSupervisedIds;
            result = result.stream()
                    .filter(topic -> inFacultyDepts.contains(topic.getDepartmentId())
                            || isOwner(topic, actor)
                            || supervisedByDean.contains(topic.getId()))
                    .toList();
        } else if (!isAdmin(actor) && ThesisDepartmentScope.isDepartmentHead(actor)) {
            String departmentId = ThesisDepartmentScope.departmentId(jdbc, actor);
            result = result.stream().filter(topic -> topic.getDepartmentId().equals(departmentId)).toList();
        }
        ThesisTopicCatalogSearch catalogSearch = ThesisTopicCatalogSearch.parse(search);
        if (catalogSearch.isActive()) {
            result = result.stream()
                    .filter(topic -> catalogSearch.matches(topic.getTitle(), topic.getDescription()))
                    .toList();
        }
        boolean published = isRoundResultsPublished(roundId);
        // One query for every topic the caller grades as a council member, so
        // the mask check below does not turn into per-topic round-trips.
        Set<UUID> gradingTopicIds = new HashSet<>();
        String lecturerId = normalize(actor == null ? null : actor.getClaimAsString("lecturerId"));
        if (!published && !isAdmin(actor) && !lecturerId.isEmpty() && !result.isEmpty()) {
            gradingTopicIds.addAll(councilTopicIds(lecturerId,
                    result.stream().map(ThesisTopic::getId).toList()));
        }
        boolean adminCaller = isAdmin(actor);
        Set<String> inFacultyDepts = deanFacultyDepts;
        Set<UUID> supervisedByDean = deanSupervisedIds;
        String callerLecturerId = lecturerId;
        return result.stream()
                .map(TopicResponse::from)
                .map(topic -> maskScoreIfNeeded(topic, published,
                        adminCaller || inFacultyDepts.contains(topic.departmentId())
                                || supervisedByDean.contains(topic.id())
                                || gradingTopicIds.contains(topic.id()),
                        callerLecturerId))
                .toList();
    }

    /**
     * Paged variant of {@link #list}: one lightweight id/title query covers the
     * whole visible set, the legacy Java title order (plus the UUID-string
     * tiebreak the paged contract already used) is applied before slicing, and
     * only the selected page is hydrated into {@link TopicResponse}. The total
     * is the size of the sorted visible id list, so it is exact for every page.
     * The read runs in one repeatable-read transaction so the key scan,
     * hydration and masking lookups see the same snapshot under PostgreSQL.
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public ListPaging.Result<TopicResponse> listPage(UUID roundId, TopicStatus status, Jwt actor,
            ListPaging.Window window) {
        if (window == null) {
            return new ListPaging.Result<>(list(roundId, status, actor), null);
        }
        CatalogPage page = listPage(roundId, status, actor, window, null);
        return new ListPaging.Result<>(page.items(), page.total());
    }

    /**
     * Catalogue-aware paged read. Both totals come from the same authorised
     * snapshot: {@code catalogTotal} counts visible topics before the search
     * predicate (the screen's "this catalogue is empty" signal) and {@code total}
     * counts the filtered set that pages. When search is active the lightweight
     * scan additionally reads {@code description}; the predicate still runs in
     * Java over exactly the visible rows, so no full row is hydrated before
     * paging and ordering stays the legacy title/UUID order.
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public CatalogPage listPage(UUID roundId, TopicStatus status, Jwt actor,
            ListPaging.Window window, String search) {
        Objects.requireNonNull(window, "a catalogue page requires a paging window");
        rounds.requireExisting(roundId);
        TopicStatus requestedStatus = status == null ? TopicStatus.PUBLISHED : status;
        List<TopicStatus> statuses;
        ThesisTopicReadRepository.Visibility visibility;
        boolean admin = isAdmin(actor);
        boolean facultyHead = ThesisDeanScope.isFacultyHead(actor);
        boolean departmentHead = ThesisDepartmentScope.isDepartmentHead(actor);
        if (requestedStatus == TopicStatus.PUBLISHED || requestedStatus == TopicStatus.APPROVED) {
            statuses = requestedStatus == TopicStatus.PUBLISHED
                    ? List.of(TopicStatus.PUBLISHED, TopicStatus.APPROVED)
                    : List.of(requestedStatus);
            // The legacy read applies its faculty/department governance filter
            // after the status branch, so it also narrows PUBLISHED/APPROVED.
            if (!admin && facultyHead) {
                String facultyId = ThesisDeanScope.facultyId(jdbc, actor);
                String lecturerId = normalize(actor == null ? null : actor.getClaimAsString("lecturerId"));
                visibility = ThesisTopicReadRepository.Visibility.faculty(
                        facultyId, ownerKeys(subject(actor), lecturerId), lecturerId);
            } else if (!admin && departmentHead) {
                visibility = ThesisTopicReadRepository.Visibility.department(
                        ThesisDepartmentScope.departmentId(jdbc, actor));
            } else {
                visibility = ThesisTopicReadRepository.Visibility.all();
            }
        } else if (admin) {
            statuses = List.of(requestedStatus);
            visibility = ThesisTopicReadRepository.Visibility.all();
        } else if (facultyHead) {
            statuses = List.of(requestedStatus);
            String facultyId = ThesisDeanScope.facultyId(jdbc, actor);
            String lecturerId = normalize(actor == null ? null : actor.getClaimAsString("lecturerId"));
            visibility = ThesisTopicReadRepository.Visibility.faculty(
                    facultyId, ownerKeys(subject(actor), lecturerId), lecturerId);
        } else if (departmentHead) {
            statuses = List.of(requestedStatus);
            visibility = ThesisTopicReadRepository.Visibility.department(
                    ThesisDepartmentScope.departmentId(jdbc, actor));
        } else if (!isLecturer(actor)) {
            statuses = List.of();
            visibility = ThesisTopicReadRepository.Visibility.none();
        } else {
            statuses = List.of(requestedStatus);
            visibility = ThesisTopicReadRepository.Visibility.owner(subject(actor));
        }
        ThesisTopicCatalogSearch catalogSearch = ThesisTopicCatalogSearch.parse(search);
        List<ThesisTopicReadRepository.TopicRef> refs = new ArrayList<>(catalogSearch.isActive()
                ? reads.findVisibleRefsWithDescription(roundId, statuses, visibility)
                : reads.findVisibleRefs(roundId, statuses, visibility));
        long catalogTotal = refs.size();
        if (catalogSearch.isActive()) {
            refs = new ArrayList<>(refs.stream()
                    .filter(ref -> catalogSearch.matches(ref.title(), ref.description()))
                    .toList());
        }
        refs.sort(Comparator.comparing(ThesisTopicReadRepository.TopicRef::title)
                .thenComparing(ref -> ref.id().toString()));
        long total = refs.size();
        long from = window.offset();
        if (from >= total) {
            return new CatalogPage(List.of(), total, catalogTotal);
        }
        int to = (int) Math.min(total, from + window.limit());
        List<UUID> pageIds = refs.subList((int) from, to).stream()
                .map(ThesisTopicReadRepository.TopicRef::id).toList();
        Map<UUID, TopicResponse> hydrated = new HashMap<>();
        for (TopicResponse response : reads.findResponsesByIds(pageIds)) {
            hydrated.put(response.id(), response);
        }
        List<TopicResponse> page = pageIds.stream()
                .map(hydrated::get)
                .filter(Objects::nonNull)
                .toList();
        return new CatalogPage(maskPage(roundId, actor, page), total, catalogTotal);
    }

    /** One catalogue page plus the two totals the HTTP contract exposes. */
    public record CatalogPage(List<TopicResponse> items, long total, long catalogTotal) {
    }

    private List<TopicResponse> maskPage(UUID roundId, Jwt actor, List<TopicResponse> page) {
        if (page.isEmpty()) {
            return page;
        }
        boolean published = isRoundResultsPublished(roundId);
        boolean admin = isAdmin(actor);
        String lecturerId = normalize(actor == null ? null : actor.getClaimAsString("lecturerId"));
        List<UUID> pageIds = page.stream().map(TopicResponse::id).toList();
        // Reviewer identity is masked even after publication for callers who
        // are not grading stakeholders, so dean scope must be resolved whether
        // or not the round has published results.
        Set<String> deanFacultyDepts = Set.of();
        Set<UUID> deanSupervisedIds = Set.of();
        if (!admin && ThesisDeanScope.isFacultyHead(actor)) {
            deanFacultyDepts = facultyDepartmentIds(ThesisDeanScope.facultyId(jdbc, actor));
            if (!lecturerId.isEmpty()) {
                deanSupervisedIds = new HashSet<>(supervisedTopicIds(lecturerId, pageIds));
            }
        }
        Set<UUID> gradingTopicIds = new HashSet<>();
        if (!published && !admin && !lecturerId.isEmpty()) {
            gradingTopicIds.addAll(councilTopicIds(lecturerId, pageIds));
        }
        Set<String> inFacultyDepts = deanFacultyDepts;
        Set<UUID> supervisedByDean = deanSupervisedIds;
        Set<UUID> grading = gradingTopicIds;
        String callerLecturerId = lecturerId;
        return page.stream()
                .map(topic -> maskScoreIfNeeded(topic, published,
                        admin || inFacultyDepts.contains(topic.departmentId())
                                || supervisedByDean.contains(topic.id())
                                || grading.contains(topic.id()),
                        callerLecturerId))
                .toList();
    }

    private Set<String> facultyDepartmentIds(String facultyId) {
        if (facultyId == null) {
            return Set.of();
        }
        return new HashSet<>(jdbc.queryForList(
                "SELECT \"id\" FROM academic.\"Department\" WHERE \"facultyId\" = :facultyId",
                new org.springframework.jdbc.core.namedparam.MapSqlParameterSource("facultyId", facultyId),
                String.class));
    }

    private List<UUID> supervisedTopicIds(String lecturerId, List<UUID> topicIds) {
        return jdbc.queryForList(
                "SELECT topic_id FROM thesis.thesis_topic_supervisor"
                        + " WHERE lecturer_id = :lecturerId AND topic_id IN (:topicIds)",
                new org.springframework.jdbc.core.namedparam.MapSqlParameterSource()
                        .addValue("lecturerId", lecturerId)
                        .addValue("topicIds", topicIds),
                UUID.class);
    }

    private List<UUID> councilTopicIds(String lecturerId, List<UUID> topicIds) {
        return jdbc.queryForList(
                "SELECT ct.topic_id FROM thesis.thesis_council_topic ct "
                        + "JOIN thesis.thesis_council_member m ON m.council_id = ct.council_id "
                        + "WHERE m.lecturer_id = :lecturerId AND ct.topic_id IN (:topicIds)",
                new org.springframework.jdbc.core.namedparam.MapSqlParameterSource()
                        .addValue("lecturerId", lecturerId)
                        .addValue("topicIds", topicIds),
                UUID.class);
    }

    private static List<String> ownerKeys(String subject, String lecturerId) {
        java.util.LinkedHashSet<String> keys = new java.util.LinkedHashSet<>();
        if (!subject.isEmpty()) {
            keys.add(subject);
        }
        if (!lecturerId.isEmpty()) {
            keys.add(lecturerId);
        }
        return List.copyOf(keys);
    }

    /**
     * A hidden (non-published) topic responds 404 to callers who are neither
     * its owner nor an admin, so ids cannot be used to enumerate drafts.
     */
    @Transactional(readOnly = true)
    public TopicResponse get(UUID id, Jwt actor) {
        ThesisTopic topic = topics.findById(id)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "Thesis topic not found"));
        boolean deanInScope = ThesisDeanScope.canAccessTopic(jdbc, actor, topic.getId(), topic.getDepartmentId());
        if (topic.getStatus() != TopicStatus.PUBLISHED && topic.getStatus() != TopicStatus.APPROVED
                && !isAdmin(actor) && !deanInScope && !isOwner(topic, actor)
                && !ThesisDepartmentScope.owns(jdbc, actor, topic.getDepartmentId())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Thesis topic not found");
        }
        return maskScoreIfNeeded(TopicResponse.from(topic), isRoundResultsPublished(topic.getRoundId()),
                deanInScope || isCouncilGraderOf(topic.getId(), actor),
                normalize(actor == null ? null : actor.getClaimAsString("lecturerId")));
    }

    /**
     * Scores stay internal until the round publishes results: students (and
     * lecturers who are not grading the topic) must not read a finalized
     * council score off the topic resource early. Governance staff and the
     * council members assigned to the topic keep full visibility; the
     * supervisor sees the result with everyone else at publication.
     */
    private TopicResponse maskScoreIfNeeded(TopicResponse topic, boolean roundPublished, boolean councilGrader,
            String callerLecturerId) {
        // The assigned GVPB reviewer is a grading stakeholder too: they need
        // the finalization state to know the counter-review window is closed,
        // while a plain student or unrelated lecturer never does.
        boolean assignedReviewer = topic.gvpbLecturerId() != null
                && topic.gvpbLecturerId().equals(callerLecturerId);
        boolean internalGrader = councilGrader || assignedReviewer;
        boolean scoreMasked = !roundPublished && !internalGrader
                && (topic.finalScore() != null || topic.resultStatus() != null);
        // The GVPB reviewer identity is internal governance data: students and
        // unrelated lecturers must not learn who counter-reviews a topic.
        boolean reviewerMasked = topic.gvpbLecturerId() != null
                && !internalGrader;
        if (!scoreMasked && !reviewerMasked) {
            return topic;
        }
        return new TopicResponse(
                topic.id(), topic.roundId(), topic.departmentId(), topic.title(), topic.description(),
                topic.maxGroups(), topic.status(), topic.createdBy(),
                scoreMasked ? null : topic.finalScore(),
                scoreMasked ? null : topic.resultStatus(),
                reviewerMasked ? null : topic.gvpbLecturerId());
    }

    private boolean isCouncilGraderOf(UUID topicId, Jwt actor) {
        if (isAdmin(actor)) {
            return true;
        }
        String lecturerId = normalize(actor == null ? null : actor.getClaimAsString("lecturerId"));
        if (lecturerId.isEmpty()) {
            return false;
        }
        Integer member = jdbc.queryForObject(
                "SELECT COUNT(*) FROM thesis.thesis_council_topic ct "
                        + "JOIN thesis.thesis_council_member m ON m.council_id = ct.council_id "
                        + "WHERE ct.topic_id = :topicId AND m.lecturer_id = :lecturerId",
                new org.springframework.jdbc.core.namedparam.MapSqlParameterSource()
                        .addValue("topicId", topicId)
                        .addValue("lecturerId", lecturerId),
                Integer.class);
        return member != null && member > 0;
    }

    private boolean isRoundResultsPublished(UUID roundId) {
        Integer published = jdbc.queryForObject(
                "SELECT COUNT(*) FROM thesis.thesis_registration_round WHERE id = :roundId AND status = 'RESULTS_PUBLISHED'",
                new org.springframework.jdbc.core.namedparam.MapSqlParameterSource().addValue("roundId", roundId),
                Integer.class);
        return published != null && published > 0;
    }

    private static boolean isOwner(ThesisTopic topic, Jwt actor) {
        // authorizeTopicOwner in the mutation service accepts either the user
        // subject or the lecturerId claim — this read-side check must agree.
        String actorId = subject(actor);
        String lecturerId = actor == null ? "" : normalize(actor.getClaimAsString("lecturerId"));
        return (!actorId.isEmpty() && topic.getCreatedBy().equals(actorId))
                || (!lecturerId.isEmpty() && topic.getCreatedBy().equals(lecturerId));
    }

    private static String subject(Jwt actor) {
        String subject = actor == null ? null : actor.getSubject();
        return subject == null ? "" : subject.trim();
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim();
    }

    private static boolean isAdmin(Jwt actor) {
        if (actor == null) {
            return false;
        }
        List<String> roles = actor.getClaimAsStringList("roles");
        return roles != null && (roles.contains("ADMIN") || roles.contains("SUPER_ADMIN"));
    }

    private static boolean isLecturer(Jwt actor) {
        if (actor == null) {
            return false;
        }
        List<String> roles = actor.getClaimAsStringList("roles");
        return roles != null && roles.contains("LECTURER");
    }
}
