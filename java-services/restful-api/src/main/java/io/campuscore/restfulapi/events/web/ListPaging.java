package io.campuscore.restfulapi.events.web;

import io.campuscore.restfulapi.web.DomainException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.function.Function;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * Optional {@code page}/{@code limit} window for list endpoints whose body is a
 * bare JSON array. Without either parameter the list is returned untouched, so
 * the legacy response stays byte-identical. With them the body is still the
 * bare array slice and the size of the whole authorised list travels in
 * {@link #TOTAL_COUNT_HEADER}. Slicing happens after the endpoint's own
 * authorisation filtering, never before it.
 */
public final class ListPaging {

    public static final String TOTAL_COUNT_HEADER = "X-Total-Count";
    public static final String TOTAL_COUNT_DOC = "Số bản ghi trước khi phân trang (chỉ khi có page/limit)";
    public static final String PAGE_DOC = "Trang bắt đầu từ 0; cần đi cùng limit";
    public static final String LIMIT_DOC = "Số bản ghi mỗi trang, 1 đến 100; bỏ qua cả page và limit để lấy toàn bộ";
    public static final int MAX_LIMIT = 100;

    private ListPaging() {
    }

    /** A validated window; {@code null} means the caller asked for no paging. */
    public record Window(int page, int limit) {

        /** Validates the raw query values; invalid input answers 400 before any data is read. */
        public static Window of(Integer page, Integer limit) {
            if (page == null && limit == null) {
                return null;
            }
            if (limit == null) {
                throw invalid("limit is required when page is given");
            }
            if (limit < 1 || limit > MAX_LIMIT) {
                throw invalid("limit must be between 1 and " + MAX_LIMIT);
            }
            int pageIndex = page == null ? 0 : page;
            if (pageIndex < 0) {
                throw invalid("page must be 0 or greater");
            }
            return new Window(pageIndex, limit);
        }

        /** Rejects ambiguous repeated query parameters before any data is read. */
        public static Window of(Integer page, Integer limit, HttpServletRequest request) {
            if (request != null && (repeated(request, "page") || repeated(request, "limit"))) {
                throw invalid("page and limit may be specified only once");
            }
            return of(page, limit);
        }

        public long offset() {
            return (long) page * limit;
        }

        private static boolean repeated(HttpServletRequest request, String name) {
            String[] values = request.getParameterValues(name);
            return values != null && values.length > 1;
        }
    }

    /** Database-read list and its pre-page total; total is absent for legacy unpaged calls. */
    public record Result<T>(List<T> items, Long total) {
    }

    /** Returns database-paged rows with their total, preserving the bare-array response body. */
    public static <T> ResponseEntity<List<T>> respond(Result<T> result) {
        ResponseEntity.BodyBuilder response = ResponseEntity.ok();
        if (result.total() != null) {
            response.header(TOTAL_COUNT_HEADER, String.valueOf(result.total()));
        }
        return response.body(result.items());
    }

    /** Whole list when {@code window} is null, otherwise the requested slice plus the total header. */
    public static <T> ResponseEntity<List<T>> respond(List<T> items, Window window) {
        if (window == null) {
            return ResponseEntity.ok(items);
        }
        return slice(items, window);
    }

    /**
     * Same as {@link #respond(List, Window)}, but when a window is requested the
     * rows that tie on {@code key} are first ordered by {@code id}, so
     * consecutive pages never overlap or skip a row. The endpoint's own order is
     * kept for everything that does not tie.
     */
    public static <T, K> ResponseEntity<List<T>> respond(List<T> items, Window window,
            Function<T, K> key, Function<T, ?> id) {
        if (window == null) {
            return ResponseEntity.ok(items);
        }
        return slice(tieBreak(items, key, id), window);
    }

    private static <T> ResponseEntity<List<T>> slice(List<T> ordered, Window window) {
        long from = (long) window.page() * window.limit();
        List<T> body = from >= ordered.size()
                ? List.of()
                : List.copyOf(ordered.subList((int) from, (int) Math.min(ordered.size(), from + window.limit())));
        return ResponseEntity.ok()
                .header(TOTAL_COUNT_HEADER, String.valueOf(ordered.size()))
                .body(body);
    }

    private static <T, K> List<T> tieBreak(List<T> items, Function<T, K> key, Function<T, ?> id) {
        Comparator<T> byId = Comparator.comparing(item -> String.valueOf(id.apply(item)));
        List<T> result = new ArrayList<>(items.size());
        int start = 0;
        while (start < items.size()) {
            int end = start + 1;
            K runKey = key.apply(items.get(start));
            while (end < items.size() && Objects.equals(runKey, key.apply(items.get(end)))) {
                end++;
            }
            List<T> run = new ArrayList<>(items.subList(start, end));
            run.sort(byId);
            result.addAll(run);
            start = end;
        }
        return result;
    }

    private static DomainException invalid(String message) {
        return new DomainException(HttpStatus.BAD_REQUEST, "INVALID_PAGING", message);
    }
}
