package io.campuscore.restfulapi.site;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;
import io.campuscore.restfulapi.web.DomainException;
import java.time.Instant;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Single-row KV store for the site appearance payload (accent, homepage hero
 * copy, homepage post order). The payload is the sanitized JSON object the
 * frontend already validates on read; the store only enforces existence and a
 * hard size bound so an administrator cannot wedge the table.
 */
@Service
public class SiteAppearanceStore {

    /** Single logical row; more ids are never written. */
    public static final String ROW_ID = "default";

    /** Matches the payload CHECK constraint in V73. */
    static final int MAX_PAYLOAD_CHARS = 131_072;

    /** Matches the "updatedBy" column width in V73. */
    static final int MAX_UPDATED_BY_CHARS = 255;

    private static final String TABLE = "site.\"Appearance\"";
    private static final String VERSION_FIELD = "version";
    private static final String UPDATED_AT_FIELD = "updatedAt";

    private final NamedParameterJdbcTemplate jdbc;
    private final ObjectMapper objectMapper;

    public SiteAppearanceStore(NamedParameterJdbcTemplate jdbc, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
    }

    /**
     * @return the stored payload string, or {@code null} when no appearance has
     *         been saved yet (the caller answers with an empty object and the
     *         frontend sanitizer fills the defaults).
     */
    public String read() {
        var rows = jdbc.getJdbcTemplate().queryForList(
                "SELECT \"payload\" FROM " + TABLE + " WHERE \"id\" = ?",
                String.class,
                ROW_ID);
        return rows.isEmpty() ? null : rows.get(0);
    }

    /** Legacy save without a precondition; see {@link #write(String, String, Long)}. */
    public String write(String payload, String updatedBy) {
        return write(payload, updatedBy, null);
    }

    /**
     * Upserts the payload, keeping a single row and the acting administrator
     * label for accountability. Written as update-then-insert rather than
     * INSERT .. ON CONFLICT so the statement stays portable across PostgreSQL
     * and the H2 test engine.
     *
     * <p>The stored payload carries the write stamp: {@code version} and
     * {@code updatedAt} are overwritten here, so a browser polling this row can
     * tell one save from the next. Echoing the caller's payload instead would
     * make a save from one machine invisible to every other machine.
     *
     * @param payload raw JSON object text; must already be parsed and within
     *                {@link #MAX_PAYLOAD_CHARS}
     * @param updatedBy immutable actor id (JWT subject) of the writer
     * @param expectedVersion version the caller last read, or {@code null} to
     *                keep the legacy last-write-wins save. A conditional save
     *                compares that version inside the UPDATE statement, so a
     *                document replaced between the read and the write is
     *                reported as a conflict instead of being overwritten.
     * @return the payload text as it was stored, stamp included
     */
    public String write(String payload, String updatedBy, Long expectedVersion) {
        if (payload == null || payload.isBlank()) {
            throw new IllegalArgumentException("payload must be a JSON object");
        }
        if (payload.length() > MAX_PAYLOAD_CHARS) {
            throw new IllegalArgumentException("payload exceeds the size limit");
        }

        ObjectNode stamped;
        try {
            JsonNode parsed = objectMapper.readTree(payload);
            if (!parsed.isObject()) {
                throw new IllegalArgumentException("payload must be a JSON object");
            }
            stamped = (ObjectNode) parsed;
        } catch (JacksonException malformed) {
            throw new IllegalArgumentException("payload must be a JSON object");
        }

        String currentPayload = read();
        long stamp = nextStamp(currentPayload);
        stamped.put(VERSION_FIELD, stamp);
        stamped.put(UPDATED_AT_FIELD, Instant.ofEpochMilli(stamp).toString());
        String storedPayload = stamped.toString();
        if (storedPayload.length() > MAX_PAYLOAD_CHARS) {
            throw new IllegalArgumentException("payload exceeds the size limit");
        }
        String actor = actorLabel(updatedBy);

        if (expectedVersion == null) {
            writeLastWins(storedPayload, actor);
        } else {
            writeConditional(storedPayload, actor, currentPayload, expectedVersion);
        }

        String persisted = read();
        if (persisted == null) {
            throw new IllegalStateException("site appearance write did not persist");
        }
        return persisted;
    }

    private void writeLastWins(String storedPayload, String actor) {
        int updated = jdbc.update(
                "UPDATE " + TABLE + " SET \"payload\" = :payload, \"updatedBy\" = :updatedBy, "
                        + "\"updatedAt\" = CURRENT_TIMESTAMP WHERE \"id\" = :id",
                new MapSqlParameterSource()
                        .addValue("payload", storedPayload)
                        .addValue("updatedBy", actor)
                        .addValue("id", ROW_ID));
        if (updated == 0) {
            jdbc.update(
                    "INSERT INTO " + TABLE + " (\"id\", \"payload\", \"updatedBy\", \"updatedAt\") "
                            + "VALUES (:id, :payload, :updatedBy, CURRENT_TIMESTAMP)",
                    new MapSqlParameterSource()
                            .addValue("id", ROW_ID)
                            .addValue("payload", storedPayload)
                            .addValue("updatedBy", actor));
        }
    }

    private void writeConditional(
            String storedPayload,
            String actor,
            String currentPayload,
            long expectedVersion) {
        if (currentPayload == null || versionOf(currentPayload) != expectedVersion) {
            throw staleVersion();
        }
        int updated = jdbc.update(
                "UPDATE " + TABLE + " SET \"payload\" = :payload, \"updatedBy\" = :updatedBy, "
                        + "\"updatedAt\" = CURRENT_TIMESTAMP"
                        + " WHERE \"id\" = :id AND \"payload\" = :expectedPayload",
                new MapSqlParameterSource()
                        .addValue("payload", storedPayload)
                        .addValue("updatedBy", actor)
                        .addValue("id", ROW_ID)
                        .addValue("expectedPayload", currentPayload));
        if (updated == 0) {
            throw staleVersion();
        }
    }

    /**
     * Monotonic in the same millisecond: two saves that land on one clock tick
     * must still look like two changes to the reader's change detection.
     */
    private long nextStamp(String stored) {
        long previous = versionOf(stored);
        long now = System.currentTimeMillis();
        return Math.max(now, previous + 1);
    }

    private long versionOf(String stored) {
        if (stored == null || stored.isBlank()) {
            return 0;
        }
        try {
            JsonNode version = objectMapper.readTree(stored).get(VERSION_FIELD);
            return version == null || !version.isNumber() ? 0 : Math.max(0, version.asLong());
        } catch (JacksonException malformed) {
            // A row this store never wrote has no version to carry forward; the
            // wall-clock stamp supersedes it and this write repairs the payload.
            return 0;
        }
    }

    private static DomainException staleVersion() {
        return new DomainException(HttpStatus.CONFLICT, "STALE_VERSION",
                "The appearance settings changed; reload before editing");
    }

    /**
     * The actor label is accountability metadata, not the payload: a subject
     * longer than the column is clipped so the branding save itself never
     * fails on it.
     */
    private static String actorLabel(String updatedBy) {
        if (updatedBy == null) {
            return null;
        }
        return updatedBy.length() <= MAX_UPDATED_BY_CHARS
                ? updatedBy
                : updatedBy.substring(0, MAX_UPDATED_BY_CHARS);
    }
}
