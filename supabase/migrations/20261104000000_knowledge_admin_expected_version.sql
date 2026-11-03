-- One RPC is the only authoring surface. Keeping transitions in a single
-- transaction means a failed stage or pointer switch cannot partially publish.
create or replace function assistant.knowledge_admin_unlocked(
    p_action text,
    p_document_id uuid default null,
    p_payload jsonb default '{}'::jsonb,
    p_actor text default null
)
returns jsonb
language plpgsql
set search_path = assistant, public
as $$
declare
    v_action text := upper(btrim(coalesce(p_action, '')));
    v_actor text := nullif(btrim(coalesce(p_actor, '')), '');
    v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
    v_doc uuid;
    v_revision uuid;
    v_version integer;
    v_expected_version integer;
    v_created_by text;
    v_next_version integer;
    v_release uuid;
    v_existing_release uuid;
    v_existing_corpus_version text;
    v_hash varchar(64);
    v_corpus_version text;
    v_row_count integer;
    v_documents jsonb;
begin
    if v_actor is null or length(v_actor) > 120 then
        raise exception 'knowledge_actor_required' using errcode = 'P0001';
    end if;

    if v_action = 'LIST' or v_action = 'GET' then
        if v_action = 'GET' and p_document_id is null then
            raise exception 'knowledge_not_found' using errcode = 'P0001';
        end if;
        if v_action = 'GET' then
            select jsonb_build_object(
                'documentId', d.id, 'revisionId', latest.id,
                'version', coalesce(latest.version, 0),
                'state', case when d.active = false then 'ARCHIVED' else coalesce(latest.state, 'UNVERSIONED') end,
                'domain', coalesce(latest.domain, d.domain, 'THESIS'),
                'locale', coalesce(latest.locale, d.locale), 'slug', coalesce(latest.slug, d.slug),
                'title', coalesce(latest.title, d.title), 'content', coalesce(latest.content, d.content),
                'source', coalesce(latest.source, d.source), 'priority', coalesce(latest.priority, d.priority),
                'createdBy', latest.created_by, 'reviewedBy', latest.reviewed_by,
                'createdAt', latest.created_at, 'publishedAt', latest.published_at
            ) into v_documents
            from assistant.knowledge_document d
            left join lateral (
                select r.* from assistant.knowledge_document_revision r
                where r.document_id = d.id order by r.version desc limit 1
            ) latest on true
            where d.id = p_document_id;
            if v_documents is null then raise exception 'knowledge_not_found' using errcode = 'P0001'; end if;
            return v_documents;
        end if;

        select coalesce(jsonb_agg(row_value order by slug), '[]'::jsonb) into v_documents
        from (
            select jsonb_build_object(
                'documentId', d.id, 'revisionId', latest.id,
                'version', coalesce(latest.version, 0),
                'state', case when d.active = false then 'ARCHIVED' else coalesce(latest.state, 'UNVERSIONED') end,
                'domain', coalesce(latest.domain, d.domain, 'THESIS'),
                'locale', coalesce(latest.locale, d.locale), 'slug', coalesce(latest.slug, d.slug),
                'title', coalesce(latest.title, d.title), 'content', coalesce(latest.content, d.content),
                'source', coalesce(latest.source, d.source), 'priority', coalesce(latest.priority, d.priority),
                'createdBy', latest.created_by, 'reviewedBy', latest.reviewed_by,
                'createdAt', latest.created_at, 'publishedAt', latest.published_at
            ) as row_value,
            coalesce(latest.slug, d.slug) as slug
            from assistant.knowledge_document d
            left join lateral (
                select r.* from assistant.knowledge_document_revision r
                where r.document_id = d.id order by r.version desc limit 1
            ) latest on true
            where (nullif(btrim(v_payload ->> 'domain'), '') is null
                   or coalesce(latest.domain, d.domain, 'THESIS') = upper(btrim(v_payload ->> 'domain')))
              and (nullif(btrim(v_payload ->> 'state'), '') is null
                   or (case when d.active = false then 'ARCHIVED' else coalesce(latest.state, 'UNVERSIONED') end)
                       = upper(btrim(v_payload ->> 'state')))
        ) listed;
        return v_documents;
    end if;

    if v_action in ('CREATE', 'UPDATE') then
        perform assistant.validate_knowledge_payload(v_payload);
    end if;

    if v_action = 'CREATE' then
        v_doc := gen_random_uuid();
        v_revision := gen_random_uuid();
        insert into assistant.knowledge_document
            (id, slug, title, content, locale, source, domain, priority, active, visibility, created_at, updated_at)
        values (v_doc, btrim(v_payload ->> 'slug'), btrim(v_payload ->> 'title'), btrim(v_payload ->> 'content'),
                lower(btrim(v_payload ->> 'locale')), btrim(v_payload ->> 'source'),
                upper(btrim(coalesce(v_payload ->> 'domain', 'THESIS'))), coalesce((v_payload ->> 'priority')::smallint, 100),
                true, 'PUBLIC', now(), now());
        insert into assistant.knowledge_document_revision
            (id, document_id, version, state, domain, locale, slug, title, content, source, priority, created_by)
        values (v_revision, v_doc, 1, 'DRAFT', upper(btrim(coalesce(v_payload ->> 'domain', 'THESIS'))),
                lower(btrim(v_payload ->> 'locale')), btrim(v_payload ->> 'slug'), btrim(v_payload ->> 'title'),
                btrim(v_payload ->> 'content'), btrim(v_payload ->> 'source'), coalesce((v_payload ->> 'priority')::smallint, 100), v_actor);
        insert into assistant.knowledge_document_audit(revision_id, action, actor_id) values (v_revision, 'CREATE', v_actor);
        return jsonb_build_object('documentId', v_doc, 'revisionId', v_revision, 'version', 1, 'state', 'DRAFT');
    end if;

    if p_document_id is null then raise exception 'knowledge_not_found' using errcode = 'P0001'; end if;

    if v_action = 'UPDATE' then
        perform 1 from assistant.knowledge_document where id = p_document_id for update;
        if not found then raise exception 'knowledge_not_found' using errcode = 'P0001'; end if;
        select r.id, r.version into v_revision, v_version
        from assistant.knowledge_document_revision r
        where r.document_id = p_document_id and r.state = 'DRAFT' and r.created_by = v_actor
        order by r.version desc limit 1 for update;
        if v_revision is null then
            select coalesce(max(r.version), 0) + 1 into v_next_version
            from assistant.knowledge_document_revision r where r.document_id = p_document_id;
            v_revision := gen_random_uuid(); v_version := v_next_version;
            insert into assistant.knowledge_document_revision
                (id, document_id, version, state, domain, locale, slug, title, content, source, priority, created_by)
            values (v_revision, p_document_id, v_version, 'DRAFT', upper(btrim(coalesce(v_payload ->> 'domain', 'THESIS'))),
                    lower(btrim(v_payload ->> 'locale')), btrim(v_payload ->> 'slug'), btrim(v_payload ->> 'title'),
                    btrim(v_payload ->> 'content'), btrim(v_payload ->> 'source'), coalesce((v_payload ->> 'priority')::smallint, 100), v_actor);
        else
            v_expected_version := nullif(v_payload ->> 'expectedVersion', '')::integer;
            if v_expected_version is not null and v_expected_version <> v_version then
                raise exception 'stale_version' using errcode = 'P0001';
            end if;
            select coalesce(max(r.version), 0) + 1 into v_next_version
            from assistant.knowledge_document_revision r where r.document_id = p_document_id;
            update assistant.knowledge_document_revision
               set version = v_next_version,
                   domain = upper(btrim(coalesce(v_payload ->> 'domain', 'THESIS'))),
                   locale = lower(btrim(v_payload ->> 'locale')), slug = btrim(v_payload ->> 'slug'),
                   title = btrim(v_payload ->> 'title'), content = btrim(v_payload ->> 'content'),
                   source = btrim(v_payload ->> 'source'), priority = coalesce((v_payload ->> 'priority')::smallint, 100)
             where id = v_revision and state = 'DRAFT';
            v_version := v_next_version;
        end if;
        insert into assistant.knowledge_document_audit(revision_id, action, actor_id) values (v_revision, 'UPDATE', v_actor);
        return jsonb_build_object('documentId', p_document_id, 'revisionId', v_revision, 'version', v_version, 'state', 'DRAFT');
    end if;

    if v_action = 'SUBMIT' then
        select r.id, r.version into v_revision, v_version
        from assistant.knowledge_document_revision r
        where r.document_id = p_document_id and r.state = 'DRAFT' and r.created_by = v_actor
        order by r.version desc limit 1 for update;
        if v_revision is null then raise exception 'knowledge_state_conflict' using errcode = 'P0001'; end if;
        update assistant.knowledge_document_revision set state = 'PENDING_REVIEW' where id = v_revision and state = 'DRAFT';
        insert into assistant.knowledge_document_audit(revision_id, action, actor_id) values (v_revision, 'SUBMIT', v_actor);
        return jsonb_build_object('documentId', p_document_id, 'revisionId', v_revision, 'version', v_version, 'state', 'PENDING_REVIEW');
    end if;

    if v_action = 'PUBLISH' then
        select r.id, r.version, r.created_by,
               jsonb_build_object('domain', r.domain, 'locale', r.locale, 'slug', r.slug, 'title', r.title,
                   'content', r.content, 'source', r.source, 'priority', r.priority, 'visibility', 'PUBLIC')
          into v_revision, v_version, v_created_by, v_payload
        from assistant.knowledge_document_revision r
        where r.document_id = p_document_id and r.state = 'PENDING_REVIEW' and r.created_by <> v_actor
        order by r.version desc limit 1 for update;
        if v_revision is null then raise exception 'knowledge_second_review_required' using errcode = 'P0001'; end if;
        perform assistant.validate_knowledge_payload(v_payload);
        update assistant.knowledge_document_revision
           set state = 'ARCHIVED' where document_id = p_document_id and state = 'PUBLISHED';
        update assistant.knowledge_document_revision
           set state = 'PUBLISHED', reviewed_by = v_actor, published_at = now()
         where id = v_revision and state = 'PENDING_REVIEW';
        update assistant.knowledge_document
           set domain = v_payload ->> 'domain', locale = v_payload ->> 'locale', slug = v_payload ->> 'slug',
               title = v_payload ->> 'title', content = v_payload ->> 'content', source = v_payload ->> 'source',
               priority = (v_payload ->> 'priority')::smallint, active = true, visibility = 'PUBLIC',
               archived_at = null, archived_by = null, updated_at = now()
         where id = p_document_id;
        insert into assistant.knowledge_document_audit(revision_id, action, actor_id) values (v_revision, 'PUBLISH', v_actor);

        -- Canonical bytes are exactly the bytes validated by the Java sync
        -- service. Sorting by source_id makes the hash independent of query
        -- order and the manifest auditable.
        with canonical as (
            select d.id::text source_id, r.id::text revision_id, r.version,
                   r.domain, r.slug, r.locale, r.title, r.content, r.source, r.priority,
                   true as active, 'PUBLIC'::text as visibility, r.published_at
            from assistant.knowledge_document d
            join assistant.knowledge_document_revision r on r.document_id = d.id and r.state = 'PUBLISHED'
            where d.active = true and d.visibility = 'PUBLIC'
        ), summary as (
            select count(*)::integer as row_count,
                   encode(extensions.digest(coalesce(string_agg(
                       concat_ws('|', source_id, revision_id, version::text, domain, slug, locale, title, content,
                                 source, priority::text, active::text, visibility), E'\n' order by source_id), ''), 'sha256'), 'hex') as corpus_hash,
                   coalesce(jsonb_agg(jsonb_build_object('sourceId', source_id, 'domain', domain, 'slug', slug, 'locale', locale) order by source_id), '[]'::jsonb) as documents
            from canonical
        )
        select row_count, corpus_hash, documents into v_row_count, v_hash, v_documents from summary;
        v_release := gen_random_uuid();
        v_corpus_version := 'supabase-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '-' || substr(v_release::text, 1, 8);

        select id, corpus_version into v_existing_release, v_existing_corpus_version
        from assistant.knowledge_release where corpus_hash = v_hash limit 1;
        if v_existing_release is not null then
            update assistant.knowledge_release set status = 'ARCHIVED' where status = 'PUBLISHED' and id <> v_existing_release;
            update assistant.knowledge_release
               set status = 'PUBLISHED', reviewed_by = v_actor, reviewed_at = now(), published_at = now()
             where id = v_existing_release;
            return jsonb_build_object('documentId', p_document_id, 'revisionId', v_revision, 'version', v_version,
                'state', 'PUBLISHED', 'releaseId', v_existing_release, 'corpusVersion', v_existing_corpus_version,
                'corpusHash', v_hash, 'rowCount', v_row_count);
        end if;

        update assistant.knowledge_release set status = 'ARCHIVED' where status = 'PUBLISHED';
        insert into assistant.knowledge_release
            (id, corpus_version, corpus_hash, row_count, status, manifest, created_by, reviewed_by, reviewed_at, published_at)
        values (v_release, v_corpus_version, v_hash, v_row_count, 'PUBLISHED',
                jsonb_build_object('schemaVersion', 1, 'corpusVersion', v_corpus_version,
                    'rowCount', v_row_count, 'sha256', v_hash, 'documents', v_documents),
                v_created_by, v_actor, now(), now());
        insert into assistant.knowledge_release_document
            (release_id, source_id, revision_id, version, domain, slug, title, content, locale, source, priority, active, visibility, published_at)
        select v_release, d.id::text, r.id, r.version, r.domain, r.slug, r.title, r.content, r.locale, r.source,
               r.priority, true, 'PUBLIC', coalesce(r.published_at, now())
        from assistant.knowledge_document d
        join assistant.knowledge_document_revision r on r.document_id = d.id and r.state = 'PUBLISHED'
        where d.active = true and d.visibility = 'PUBLIC';
        return jsonb_build_object('documentId', p_document_id, 'revisionId', v_revision, 'version', v_version,
            'state', 'PUBLISHED', 'releaseId', v_release, 'corpusVersion', v_corpus_version,
            'corpusHash', v_hash, 'rowCount', v_row_count);
    end if;

    if v_action = 'ARCHIVE' then
        perform 1 from assistant.knowledge_document where id = p_document_id for update;
        if not found then raise exception 'knowledge_not_found' using errcode = 'P0001'; end if;
        update assistant.knowledge_document set active = false, archived_at = now(), archived_by = v_actor, updated_at = now()
         where id = p_document_id;
        select r.id, r.version into v_revision, v_version
        from assistant.knowledge_document_revision r where r.document_id = p_document_id order by r.version desc limit 1;
        if v_revision is not null then
            update assistant.knowledge_document_revision set state = 'ARCHIVED' where id = v_revision and state <> 'ARCHIVED';
            insert into assistant.knowledge_document_audit(revision_id, action, actor_id) values (v_revision, 'ARCHIVE', v_actor);
        end if;
        return jsonb_build_object('documentId', p_document_id, 'revisionId', v_revision, 'version', coalesce(v_version, 0), 'state', 'ARCHIVED');
    end if;

    raise exception 'knowledge_action_invalid' using errcode = 'P0001';
end;
$$;

-- The original RPC locks a document/revision before updating the release.
-- Wrap the complete RPC in one transaction-scoped lock so PUBLISH and ARCHIVE
-- serialize before either starts authoring changes or hashes the corpus.
create or replace function assistant.knowledge_admin(
    p_action text,
    p_document_id uuid default null,
    p_payload jsonb default '{}'::jsonb,
    p_actor text default null
)
returns jsonb
language plpgsql
security definer
set search_path = assistant, pg_temp
as $$
begin
    if upper(btrim(coalesce(p_action, ''))) in ('PUBLISH', 'ARCHIVE') then
        perform pg_advisory_xact_lock(64122023, 1);
    end if;
    return assistant.knowledge_admin_unlocked(p_action, p_document_id, p_payload, p_actor);
end;
$$;

revoke all on function assistant.knowledge_admin(text, uuid, jsonb, text)
    from public, anon, authenticated;
grant execute on function assistant.knowledge_admin(text, uuid, jsonb, text)
    to service_role;
-- The renamed implementation must not remain a callable RPC that can bypass
-- the transaction lock. The wrapper runs as the migration owner.
revoke all on function assistant.knowledge_admin_unlocked(text, uuid, jsonb, text)
    from public, anon, authenticated, service_role;