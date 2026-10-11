-- User-authorized rubric contract: approval requires 3..5 students; pending
-- drafts may start with the leader. Forward-only: never rewrite V100/V101,
-- remove memberships, invent replacements, or recover V100's deleted rows.
LOCK TABLE thesis.thesis_registration_round, thesis.thesis_group,
    thesis.thesis_group_member IN SHARE ROW EXCLUSIVE MODE;

-- A missing approved roster is corruption, not an incomplete draft. Refuse
-- the upgrade atomically rather than erasing its approval evidence.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM thesis.thesis_group g
               WHERE g.approval_status = 'APPROVED'
                 AND NOT EXISTS (SELECT 1 FROM thesis.thesis_group_member m WHERE m.group_id = g.id)) THEN
        RAISE EXCEPTION 'An approved thesis group has no roster; verified recovery is required before V113'
            USING ERRCODE = '23514', CONSTRAINT = 'thesis_approved_group_missing_roster';
    END IF;
END;
$$;

ALTER TABLE thesis.thesis_group
    ADD COLUMN legacy_group_size_exception BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN thesis.thesis_group.legacy_group_size_exception IS
    'V113-only marker for preexisting approved 1-2-member terminal/cancelled history; parent and roster are immutable. New approvals require 3-5.';

CREATE TEMP TABLE v113_legacy_groups ON COMMIT DROP AS
SELECT g.id, g.round_id, g.status, g.approval_status, g.leader_student_id,
       (SELECT COUNT(*) FROM thesis.thesis_group_member m WHERE m.group_id = g.id) AS member_count
FROM thesis.thesis_group g
JOIN thesis.thesis_registration_round r ON r.id = g.round_id
WHERE g.approval_status = 'APPROVED'
  AND (g.status = 'CANCELLED' OR r.status IN ('RESULTS_PUBLISHED', 'CLOSED', 'CANCELLED'))
  AND (SELECT COUNT(*) FROM thesis.thesis_group_member m WHERE m.group_id = g.id) BETWEEN 1 AND 2;

UPDATE thesis.thesis_group g SET legacy_group_size_exception = TRUE
FROM v113_legacy_groups history WHERE g.id = history.id;

CREATE TEMP TABLE v113_reopened_groups ON COMMIT DROP AS
SELECT g.id, g.approval_status, g.approved_by, g.approved_at, g.version,
       (SELECT COUNT(*) FROM thesis.thesis_group_member m WHERE m.group_id = g.id) AS member_count
FROM thesis.thesis_group g
JOIN thesis.thesis_registration_round r ON r.id = g.round_id
WHERE g.approval_status = 'APPROVED' AND g.status <> 'CANCELLED'
  AND r.status NOT IN ('RESULTS_PUBLISHED', 'CLOSED', 'CANCELLED')
  AND (SELECT COUNT(*) FROM thesis.thesis_group_member m WHERE m.group_id = g.id) BETWEEN 1 AND 2;

UPDATE thesis.thesis_group g
SET approval_status = 'PENDING', approved_by = NULL, approved_at = NULL,
    rejection_reason = 'Group requires 3-5 members before re-approval',
    updated_at = CURRENT_TIMESTAMP, version = g.version + 1
FROM v113_reopened_groups reopened WHERE g.id = reopened.id;

-- The marker can only be populated by the migration above. Existing historical
-- exceptions cannot be moved/reopened/edited to turn the exception into a new
-- approval or to change their academic record.
CREATE FUNCTION thesis.guard_legacy_group_size_exception()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.legacy_group_size_exception THEN
            RAISE EXCEPTION 'Historical thesis group % cannot be deleted', OLD.id
                USING ERRCODE = '23514', CONSTRAINT = 'thesis_legacy_size_group_read_only';
        END IF;
        RETURN OLD;
    ELSIF TG_OP = 'INSERT' THEN
        IF NEW.legacy_group_size_exception THEN
            RAISE EXCEPTION 'Legacy group-size exceptions cannot be created'
                USING ERRCODE = '23514', CONSTRAINT = 'thesis_legacy_size_marker_migration_only';
        END IF;
    ELSE
        IF NEW.legacy_group_size_exception IS DISTINCT FROM OLD.legacy_group_size_exception THEN
            RAISE EXCEPTION 'Legacy group-size markers are immutable'
                USING ERRCODE = '23514', CONSTRAINT = 'thesis_legacy_size_marker_migration_only';
        END IF;
        IF OLD.legacy_group_size_exception AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
            RAISE EXCEPTION 'Historical thesis group % is read-only', OLD.id
                USING ERRCODE = '23514', CONSTRAINT = 'thesis_legacy_size_group_read_only';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER thesis_legacy_group_size_marker
BEFORE INSERT OR UPDATE OR DELETE ON thesis.thesis_group
FOR EACH ROW EXECUTE FUNCTION thesis.guard_legacy_group_size_exception();

-- Updating only the round must not reopen the frozen historical exception.
CREATE FUNCTION thesis.guard_legacy_group_size_round()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    IF OLD.status IN ('RESULTS_PUBLISHED', 'CLOSED', 'CANCELLED')
       AND NEW.status NOT IN ('RESULTS_PUBLISHED', 'CLOSED', 'CANCELLED')
       AND EXISTS (SELECT 1 FROM thesis.thesis_group g
                   WHERE g.round_id = OLD.id AND g.legacy_group_size_exception) THEN
        RAISE EXCEPTION 'A round containing frozen historical small groups cannot be reopened'
            USING ERRCODE = '23514', CONSTRAINT = 'thesis_legacy_size_round_read_only';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER thesis_legacy_group_size_round
BEFORE UPDATE OF status ON thesis.thesis_registration_round
FOR EACH ROW EXECUTE FUNCTION thesis.guard_legacy_group_size_round();

CREATE FUNCTION thesis.guard_legacy_group_size_roster()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE old_group UUID; new_group UUID;
BEGIN
    IF TG_OP <> 'INSERT' THEN old_group := OLD.group_id; END IF;
    IF TG_OP <> 'DELETE' THEN new_group := NEW.group_id; END IF;
    -- Stable parent-lock order also fences attempts to move a historical row.
    PERFORM id FROM thesis.thesis_group
    WHERE id = old_group OR id = new_group ORDER BY id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM thesis.thesis_group
               WHERE (id = old_group OR id = new_group) AND legacy_group_size_exception) THEN
        RAISE EXCEPTION 'Historical small-group membership is read-only'
            USING ERRCODE = '23514', CONSTRAINT = 'thesis_legacy_size_roster_read_only';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER thesis_group_member_legacy_size_read_only
BEFORE INSERT OR UPDATE OR DELETE ON thesis.thesis_group_member
FOR EACH ROW EXECUTE FUNCTION thesis.guard_legacy_group_size_roster();

-- Preserve V65's deferred serialization and every structural invariant.
CREATE OR REPLACE FUNCTION thesis.validate_group_membership_state(p_group_id UUID)
RETURNS VOID LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
    group_round_id UUID; group_leader_id VARCHAR(120); member_count INTEGER;
    leader_count INTEGER; current_approval_status VARCHAR(32); group_status VARCHAR(32);
    round_status VARCHAR(32); legacy_exception BOOLEAN;
BEGIN
    PERFORM 1 FROM thesis.thesis_group WHERE id = p_group_id FOR UPDATE;
    SELECT g.round_id, g.leader_student_id, g.approval_status, g.status,
           g.legacy_group_size_exception, r.status
    INTO group_round_id, group_leader_id, current_approval_status, group_status,
         legacy_exception, round_status
    FROM thesis.thesis_group g JOIN thesis.thesis_registration_round r ON r.id = g.round_id
    WHERE g.id = p_group_id;
    IF NOT FOUND THEN RETURN; END IF;
    SELECT COUNT(*)::INTEGER, COUNT(*) FILTER (WHERE gm.is_leader)::INTEGER
    INTO member_count, leader_count FROM thesis.thesis_group_member gm WHERE gm.group_id = p_group_id;
    IF member_count > 5 THEN
        RAISE EXCEPTION 'Thesis group % cannot have more than 5 members', p_group_id
            USING ERRCODE = '23514', CONSTRAINT = 'thesis_group_member_count';
    END IF;
    IF member_count > 0 AND leader_count <> 1 THEN
        RAISE EXCEPTION 'Thesis group % must have exactly one leader', p_group_id
            USING ERRCODE = '23514', CONSTRAINT = 'thesis_group_one_leader';
    END IF;
    IF member_count > 0 AND NOT EXISTS (SELECT 1 FROM thesis.thesis_group_member gm
        WHERE gm.group_id = p_group_id AND gm.is_leader AND gm.student_id = group_leader_id) THEN
        RAISE EXCEPTION 'Thesis group % leader_student_id must match its leader member', p_group_id
            USING ERRCODE = '23514', CONSTRAINT = 'thesis_group_leader_consistency';
    END IF;
    IF EXISTS (SELECT 1 FROM thesis.thesis_group_member gm
        WHERE gm.group_id = p_group_id AND gm.round_id <> group_round_id) THEN
        RAISE EXCEPTION 'Thesis group % has a member from another round', p_group_id
            USING ERRCODE = '23514', CONSTRAINT = 'thesis_group_round_consistency';
    END IF;
    IF legacy_exception AND (current_approval_status <> 'APPROVED'
        OR member_count NOT BETWEEN 1 AND 2
        OR (group_status <> 'CANCELLED' AND round_status NOT IN ('RESULTS_PUBLISHED', 'CLOSED', 'CANCELLED'))) THEN
        RAISE EXCEPTION 'Historical thesis group % no longer matches its frozen exception', p_group_id
            USING ERRCODE = '23514', CONSTRAINT = 'thesis_legacy_size_exception_invalid';
    END IF;
    IF current_approval_status = 'APPROVED' AND member_count NOT BETWEEN 3 AND 5 AND NOT legacy_exception THEN
        RAISE EXCEPTION 'Approved thesis group % must have between 3 and 5 members (found %)', p_group_id, member_count
            USING ERRCODE = '23514', CONSTRAINT = 'thesis_approved_group_member_count';
    END IF;
END;
$$;

ALTER TABLE thesis.thesis_group_member DROP CONSTRAINT IF EXISTS thesis_group_member_order_valid;
-- Historical out-of-range seat labels remain readable. All new writes satisfy
-- the new CHECK; max headcount/one leader/round/active uniqueness remain enforced.
ALTER TABLE thesis.thesis_group_member
    ADD CONSTRAINT thesis_group_member_order_valid CHECK (member_order BETWEEN 1 AND 5) NOT VALID;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM thesis.thesis_group_member WHERE member_order NOT BETWEEN 1 AND 5) THEN
        ALTER TABLE thesis.thesis_group_member VALIDATE CONSTRAINT thesis_group_member_order_valid;
    END IF;
END;
$$;

-- Fail atomically on untouched structural corruption; do not hide it behind a
-- deferred trigger that only sees rows modified during this upgrade.
DO $$
DECLARE checked_group UUID;
BEGIN
    FOR checked_group IN SELECT id FROM thesis.thesis_group ORDER BY id LOOP
        PERFORM thesis.validate_group_membership_state(checked_group);
    END LOOP;
END;
$$;

INSERT INTO campuscore_audit."AdminAudit"
    ("id", "actorId", "actorLabel", "action", "entityType", "entityId", "summary", "beforeState", "afterState", "createdAt")
SELECT 'v113-reopened-' || id, 'system-migration', 'V113 group policy migration',
       'THESIS_GROUP_POLICY_REOPENED', 'ThesisGroup', id::text,
       'Reopen a live deficient approval; retain roster, leader, reports and scores',
       jsonb_build_object('approvalStatus', approval_status, 'approvedBy', approved_by,
           'approvedAt', approved_at, 'version', version, 'memberCount', member_count)::text,
       jsonb_build_object('approvalStatus', 'PENDING', 'version', version + 1, 'rule', '3-5')::text,
       CURRENT_TIMESTAMP FROM v113_reopened_groups;

INSERT INTO campuscore_audit."AdminAudit"
    ("id", "actorId", "actorLabel", "action", "entityType", "entityId", "summary", "beforeState", "afterState", "createdAt")
SELECT 'v113-legacy-' || id, 'system-migration', 'V113 group policy migration',
       'THESIS_GROUP_POLICY_HISTORY_PRESERVED', 'ThesisGroup', id::text,
       'Freeze preexisting small terminal/cancelled group without rewriting its academic record',
       jsonb_build_object('memberCount', member_count, 'status', status, 'approvalStatus', approval_status)::text,
       '{"legacyGroupSizeException":true,"readOnly":true,"newApprovalRule":"3-5"}',
       CURRENT_TIMESTAMP FROM v113_legacy_groups;

-- RAG: update only the six exact, unchanged V101 seed revisions. Human edits,
-- new revisions and foreign authority are never rewritten. The complete active
-- release (V101, or a later MANUAL/LEGACY release such as V103 built on it) is
-- projected, and activated only if all six served rows still match V101.
CREATE TEMP TABLE v113_expected_policy (
    id UUID PRIMARY KEY, slug TEXT NOT NULL, locale TEXT NOT NULL,
    old_version INTEGER NOT NULL, old_hash TEXT NOT NULL
) ON COMMIT DROP;
INSERT INTO v113_expected_policy VALUES
('e978ca2e-60d3-66fb-c6f5-b48c4f36af57','campus-portal-comprehensive-service-directory-en','en',3,'a8056771714befe980e2483a801d64ea'),
('5cfd3954-733e-6249-8664-3850ac12d486','campus-portal-comprehensive-service-directory-vi','vi',3,'6fb50fa58903aae8f8180dc2001d1e54'),
('c6ee2794-5011-f932-eccf-255b89dec6a1','graduation-thesis-eligibility-defense-en','en',4,'774f33ef592d641815fbf6f77ecbf475'),
('07abc8cf-053c-1c92-306f-8e49c87d1e5c','graduation-thesis-eligibility-defense-vi','vi',4,'07c672cf7b10caeb21004769d83ddaa2'),
('9186a0e3-b6fe-ff84-6d26-33c9f1fc817e','thesis-group-members-rules-en','en',3,'2de994140bc508fcd077d6a33c926cf9'),
('b5706947-1a3c-42b1-ba24-b8f66d664a76','thesis-group-members-rules-vi','vi',3,'f7d259b9ebd848d7b6d5a95d2f52f10a');

-- Use the governed publisher's document/revision -> pointer lock order.
-- Lock every revision of each expected document so later human edits stay
-- visible to the eligibility guard, rather than racing an activation.
SELECT d.id FROM assistant.knowledge_document d
JOIN v113_expected_policy expected ON expected.id = d.id
JOIN assistant.knowledge_document_revision r ON r.document_id = d.id
ORDER BY d.id, r.version FOR UPDATE OF d, r;
SELECT active_release_id FROM assistant.knowledge_runtime_state WHERE singleton FOR UPDATE;

CREATE TEMP TABLE v113_changed_document ON COMMIT DROP AS
SELECT d.id, r.id AS old_revision_id, r.version AS old_version,
       r.published_at AS old_published_at, expected.old_hash,
       replace(replace(replace(replace(d.content,
           '1 đến 3 thành viên', '3 đến 5 thành viên để được duyệt'),
           '1 đến 3 sinh viên', '3 đến 5 sinh viên để được duyệt'),
           '1 to 3 members', '3 to 5 members for approval'),
           '1 to 3 students', '3 to 5 students for approval') ||
       CASE WHEN d.locale = 'vi' THEN
           E'\n\nQuy định nhóm hiện hành trên hệ thống: để được duyệt, nhóm cần 3 đến 5 sinh viên và đúng một nhóm trưởng. Nhóm nháp có thể bắt đầu với 1 hoặc 2 sinh viên rồi bổ sung trước khi duyệt; tối đa 5 và không được xóa nhóm đã duyệt xuống dưới 3. Nhóm nhỏ đã hoàn thành hoặc hủy trước V113 được giữ nguyên để tra cứu lịch sử, không sửa thành viên hoặc mở lại. Chỉ nhóm trưởng được nộp báo cáo.'
       ELSE
           E'\n\nCurrent system group policy: approval requires 3 to 5 students and exactly one leader. Drafts may start with 1 or 2 students and be completed before approval; the maximum is 5 and an approved roster cannot be reduced below 3. Pre-V113 small completed or cancelled groups are preserved read-only for historical lookup and cannot be reopened. Only the group leader may submit reports.'
       END AS content
FROM assistant.knowledge_document d
JOIN v113_expected_policy expected ON expected.id = d.id AND expected.slug = d.slug AND expected.locale = d.locale
JOIN assistant.knowledge_document_revision r ON r.document_id = d.id AND r.version = expected.old_version
WHERE d.active AND d.visibility = 'PUBLIC' AND d.archived_at IS NULL AND d.archived_by IS NULL
  AND d.source = 'campuscore-thesis-spec-correction-v101'
  AND r.state = 'PUBLISHED' AND r.source = d.source AND r.slug = d.slug AND r.locale = d.locale
  AND r.domain = d.domain AND r.priority = d.priority
  AND r.created_by = 'system-migration' AND r.reviewed_by = 'system-migration'
  AND md5(d.title || E'\n' || d.content) = expected.old_hash
  AND md5(r.title || E'\n' || r.content) = expected.old_hash
  AND NOT EXISTS (SELECT 1 FROM assistant.knowledge_document_revision later
      WHERE later.document_id = d.id AND later.version > expected.old_version);

UPDATE assistant.knowledge_document d SET content = changed.content,
    source = 'campuscore-thesis-rubric-correction-v113', updated_at = CURRENT_TIMESTAMP
FROM v113_changed_document changed WHERE d.id = changed.id;
UPDATE assistant.knowledge_document_revision r SET state = 'ARCHIVED'
FROM v113_changed_document changed WHERE r.id = changed.old_revision_id;
INSERT INTO assistant.knowledge_document_revision
    (id, document_id, version, state, domain, locale, slug, title, content, source, priority, created_by, reviewed_by, published_at)
SELECT md5(d.id::text || '-rubric-correction-v113')::uuid, d.id, changed.old_version + 1,
       'PUBLISHED', d.domain, d.locale, d.slug, d.title, d.content, d.source, d.priority,
       'system-migration', 'system-migration', CURRENT_TIMESTAMP
FROM assistant.knowledge_document d JOIN v113_changed_document changed ON changed.id = d.id;

CREATE TEMP TABLE v113_overlay ON COMMIT DROP AS
SELECT changed.id FROM assistant.knowledge_runtime_document p
JOIN v113_changed_document changed ON changed.id::text = p.source_id
JOIN v113_expected_policy expected ON expected.id = changed.id
WHERE p.release_id = (SELECT active_release_id FROM assistant.knowledge_runtime_state WHERE singleton)
  AND p.revision_id = changed.old_revision_id AND p.version = changed.old_version
  AND p.slug = expected.slug AND p.locale = expected.locale AND p.active AND p.visibility = 'PUBLIC'
  AND p.source = 'campuscore-thesis-spec-correction-v101'
  AND p.published_at = changed.old_published_at
  AND md5(p.title || E'\n' || p.content) = expected.old_hash;

CREATE TEMP TABLE v113_projected_runtime ON COMMIT DROP AS
SELECT p.source_id, COALESCE(r.id, p.revision_id) AS revision_id,
       COALESCE(r.version, p.version) AS version, COALESCE(r.domain, p.domain) AS domain,
       COALESCE(r.slug, p.slug) AS slug, COALESCE(r.locale, p.locale) AS locale,
       COALESCE(r.title, p.title) AS title, COALESCE(r.content, p.content) AS content,
       COALESCE(r.source, p.source) AS source, COALESCE(r.priority, p.priority) AS priority,
       p.active, p.visibility, COALESCE(r.published_at, p.published_at) AS published_at
FROM assistant.knowledge_runtime_state s
JOIN assistant.knowledge_release current_release ON current_release.id = s.active_release_id
JOIN assistant.knowledge_runtime_document p ON p.release_id = current_release.id
LEFT JOIN v113_overlay changed ON changed.id::text = p.source_id
LEFT JOIN assistant.knowledge_document_revision r ON r.document_id = changed.id
    AND r.id = md5(changed.id::text || '-rubric-correction-v113')::uuid AND r.state = 'PUBLISHED'
WHERE s.singleton AND current_release.status = 'PUBLISHED' AND current_release.source IN ('MANUAL', 'LEGACY')
  AND (SELECT COUNT(*) FROM v113_overlay) = 6;

CREATE TEMP TABLE v113_summary ON COMMIT DROP AS
SELECT COUNT(*)::INTEGER AS row_count,
       encode(thesis.digest(COALESCE(string_agg(concat_ws('|', source_id,
           COALESCE(revision_id::text, ''), version::text, domain, slug, locale, title, content,
           source, priority::text, active::text, visibility), E'\n' ORDER BY source_id), ''), 'sha256'), 'hex') AS corpus_hash,
       COALESCE(jsonb_agg(jsonb_build_object('sourceId', source_id, 'domain', domain,
           'slug', slug, 'locale', locale) ORDER BY source_id), '[]'::jsonb) AS documents
FROM v113_projected_runtime;
INSERT INTO assistant.knowledge_release
    (id, corpus_version, corpus_hash, row_count, source, status, manifest, created_by, activated_at, previous_release_id)
SELECT '00000000-0000-0000-0000-000000000113'::uuid, 'local-demo-v113', summary.corpus_hash,
       summary.row_count, 'MANUAL', 'PUBLISHED', jsonb_build_object('schemaVersion', 1,
           'corpusVersion', 'local-demo-v113', 'rowCount', summary.row_count,
           'sha256', summary.corpus_hash, 'documents', summary.documents),
       'system-migration', CURRENT_TIMESTAMP, s.active_release_id
FROM v113_summary summary CROSS JOIN assistant.knowledge_runtime_state s
WHERE s.singleton AND EXISTS (SELECT 1 FROM v113_projected_runtime);
INSERT INTO assistant.knowledge_runtime_document
    (release_id, source_id, revision_id, version, domain, slug, locale, title, content, source, priority, active, visibility, published_at)
SELECT '00000000-0000-0000-0000-000000000113'::uuid, source_id, revision_id, version,
       domain, slug, locale, title, content, source, priority, active, visibility, published_at
FROM v113_projected_runtime;
UPDATE assistant.knowledge_runtime_state s SET active_release_id = next_release.id, updated_at = CURRENT_TIMESTAMP
FROM assistant.knowledge_release next_release
WHERE s.singleton AND next_release.id = '00000000-0000-0000-0000-000000000113'::uuid
  AND s.active_release_id = next_release.previous_release_id
  AND EXISTS (SELECT 1 FROM v113_projected_runtime);

-- A new notice supersedes prior policy prose; historical notices and audits
-- remain intact. This does not assert an externally verified university rule.
INSERT INTO engagement."Announcement"
    ("id", "title", "slug", "summary", "content", "priority", "status", "categoryId",
     "readingTimeMinutes", "viewCount", "uniqueReaderCount", "isGlobal", "targetRoles", "targetYears",
     "publishAt", "publishedBy", "createdAt", "updatedAt", "version")
VALUES ('announcement-thesis-group-size-rubric-v113',
    'Cập nhật quy định nhóm đồ án trên hệ thống: 3–5 sinh viên',
    'quy-dinh-nhom-do-an-rubric-3-5',
    'Nhóm cần 3–5 sinh viên và đúng một nhóm trưởng để được duyệt; nhóm nháp có thể chưa đủ thành viên.',
    '<p>Quy định nhóm trên hệ thống đã cập nhật theo yêu cầu nghiệp vụ: <strong>3–5 sinh viên</strong>, <strong>đúng một nhóm trưởng</strong> để được duyệt. Nhóm nháp được bổ sung dần thành viên. Không được tham gia đồng thời hai nhóm đang hoạt động trong cùng đợt; chỉ nhóm trưởng nộp báo cáo.</p><p>Thông báo này thay thế giới hạn 1–3 trong thông báo V101. Những nhóm nhỏ đã hoàn thành hoặc hủy được giữ nguyên để tra cứu lịch sử.</p><p>Groups require 3 to 5 students and exactly one leader for approval. Incomplete drafts are allowed; completed/cancelled legacy records remain read-only.</p>',
    'HIGH', 'PUBLISHED', (SELECT "id" FROM engagement."ArticleCategory" WHERE "code" = 'ACADEMIC_AFFAIRS'),
    2, 0, 0, TRUE, ARRAY['STUDENT', 'LECTURER', 'ADMIN']::TEXT[], ARRAY[]::INTEGER[],
    CURRENT_TIMESTAMP, 'Hệ thống CampusUTE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1);

INSERT INTO engagement."AnnouncementAudit"
    ("id", "announcementId", "action", "actorId", "actorLabel", "reason", "version", "beforeState", "afterState", "createdAt")
VALUES ('audit-announcement-thesis-group-size-rubric-v113', 'announcement-thesis-group-size-rubric-v113',
    'CREATED', 'system-migration', 'V113 group policy migration',
    'Append policy correction after the authorized rubric decision; retain historical notices.', 1, NULL,
    '{"rule":"3-5","supersedes":"announcement-thesis-group-size-correction-v101"}', CURRENT_TIMESTAMP);

INSERT INTO campuscore_audit."AdminAudit"
    ("id", "actorId", "actorLabel", "action", "entityType", "entityId", "summary", "beforeState", "afterState", "createdAt")
SELECT 'audit-thesis-rubric-correction-v113', 'system-migration', 'V113 group policy migration',
       'RECONCILE_THESIS_GROUP_SIZE_DOCUMENTS', 'KnowledgeRelease',
       (SELECT active_release_id::text FROM assistant.knowledge_runtime_state WHERE singleton),
       CASE WHEN EXISTS (SELECT 1 FROM v113_projected_runtime)
           THEN 'Corrected six unchanged local policy documents and activated the complete immutable V113 release'
           ELSE 'Authoring correction guarded; served policy update deferred to the authority owner because the exact six-row local base was unavailable' END,
       '{"expectedBase":"active MANUAL/LEGACY release serving the V101 rows","supersededRule":"1-3"}',
       jsonb_build_object('rule', '3-5', 'changedDocuments', (SELECT COUNT(*) FROM v113_changed_document),
           'activeReleaseId', (SELECT active_release_id::text FROM assistant.knowledge_runtime_state WHERE singleton),
           'servedOverlayDocuments', (SELECT COUNT(*) FROM v113_overlay),
           'activated', EXISTS (SELECT 1 FROM v113_projected_runtime),
           'servedPolicyStatus', CASE WHEN EXISTS (SELECT 1 FROM v113_projected_runtime)
               THEN 'LOCAL_CORRECTED' ELSE 'AUTHORITY_REVIEW_REQUIRED' END)::TEXT, CURRENT_TIMESTAMP;
