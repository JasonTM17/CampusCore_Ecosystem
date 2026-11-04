package io.campuscore.restfulapi.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import io.campuscore.restfulapi.web.ApiErrorWriter;

/**
 * Caps the size of JSON bodies before Jackson materialises them.
 *
 * <p>Multipart limits exist at the servlet level, but a JSON request is read
 * in full before message-length validation runs, so an unbounded body is an
 * unbounded memory allocation. Three caps apply, tightest first (audit S5):
 *
 * <ul>
 *   <li>{@code /api/v1/auth/login|refresh|change-password|logout} — 4 KB:
 *       credential bodies are a couple of fields; anything larger is already a
 *       probe, and these are the routes an anonymous attacker can hit.</li>
 *   <li>{@code /api/v1/assistant/*} and {@code /api/v1/thesis/assistant/*} —
 *       64 KB: comfortably exceeds the largest legitimate assistant message +
 *       metadata; anything approaching this cap is already invalid by the
 *       message-length rule and only exists to exhaust memory.</li>
 *   <li>every other route — 1 MB: a generous global ceiling. This includes
 *       {@code PUT /api/v1/auth/profile}, whose avatar contract legitimately
 *       carries up to a 200 KB base64 data URL and relies on bean validation
 *       to answer 400 for anything larger.</li>
 * </ul>
 *
 * <p>A declared {@code Content-Length} is only a fast path. Chunked and HTTP/2
 * bodies report no length, so an unknown-length JSON body is read once through
 * a bounded buffer here: anything above the cap is answered 413 before the
 * body reaches a message converter, and exactly the accepted bytes are replayed
 * downstream.
 */
@Component
public class JsonBodyCapFilter extends OncePerRequestFilter {

    /** Global ceiling for JSON bodies on any route (audit S5). */
    static final long MAX_JSON_BYTES_GLOBAL = 1024 * 1024L;

    /** Tighter ceiling for assistant chat routes. */
    static final long MAX_JSON_BYTES_ASSISTANT = 64 * 1024L;

    /** Tightest ceiling for the unauthenticated credential routes. */
    static final long MAX_JSON_BYTES_AUTH = 4 * 1024L;

    private static final int READ_CHUNK_BYTES = 8192;

    private static final List<String> TIGHT_AUTH_ROUTES = List.of(
            "/api/v1/auth/login",
            "/api/v1/auth/refresh",
            "/api/v1/auth/change-password",
            "/api/v1/auth/forgot-password",
            "/api/v1/auth/reset-password",
            "/api/v1/auth/logout");

    private final ApiErrorWriter errorWriter;

    public JsonBodyCapFilter(ApiErrorWriter errorWriter) {
        this.errorWriter = errorWriter;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String contentType = request.getContentType();
        boolean json = contentType != null && contentType.toLowerCase().contains("application/json");
        if (!json) {
            chain.doFilter(request, response);
            return;
        }
        long cap = capFor(request.getRequestURI());
        long length = request.getContentLengthLong();
        if (length > cap) {
            reject(request, response);
            return;
        }
        if (length < 0) {
            byte[] body = readWithinCap(request.getInputStream(), cap);
            if (body == null) {
                reject(request, response);
                return;
            }
            chain.doFilter(new BufferedBodyRequest(request, body), response);
            return;
        }
        chain.doFilter(request, response);
    }

    private void reject(HttpServletRequest request, HttpServletResponse response) throws IOException {
        errorWriter.write(request, response, org.springframework.http.HttpStatus.PAYLOAD_TOO_LARGE,
                "REQUEST_BODY_TOO_LARGE", "Request body exceeds the accepted size");
    }

    /** Returns the accepted bytes, or null as soon as the stream exceeds the cap. */
    private static byte[] readWithinCap(InputStream input, long cap) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream((int) Math.min(cap, READ_CHUNK_BYTES));
        byte[] chunk = new byte[READ_CHUNK_BYTES];
        long total = 0;
        int read;
        while ((read = input.read(chunk)) != -1) {
            total += read;
            if (total > cap) {
                return null;
            }
            buffer.write(chunk, 0, read);
        }
        return buffer.toByteArray();
    }

    /** Replays a body that was already read and length-checked by the filter. */
    private static final class BufferedBodyRequest extends HttpServletRequestWrapper {

        private final byte[] body;

        BufferedBodyRequest(HttpServletRequest request, byte[] body) {
            super(request);
            this.body = body;
        }

        @Override
        public ServletInputStream getInputStream() {
            return new ByteArrayServletInputStream(body);
        }

        @Override
        public BufferedReader getReader() {
            String encoding = getCharacterEncoding();
            Charset charset = encoding == null ? StandardCharsets.UTF_8 : Charset.forName(encoding);
            return new BufferedReader(new InputStreamReader(getInputStream(), charset));
        }

        @Override
        public int getContentLength() {
            return body.length;
        }

        @Override
        public long getContentLengthLong() {
            return body.length;
        }
    }

    private static final class ByteArrayServletInputStream extends ServletInputStream {

        private final ByteArrayInputStream delegate;

        ByteArrayServletInputStream(byte[] body) {
            this.delegate = new ByteArrayInputStream(body);
        }

        @Override
        public int read() {
            return delegate.read();
        }

        @Override
        public int read(byte[] bytes, int offset, int length) {
            return delegate.read(bytes, offset, length);
        }

        @Override
        public boolean isFinished() {
            return delegate.available() == 0;
        }

        @Override
        public boolean isReady() {
            return true;
        }

        @Override
        public void setReadListener(ReadListener listener) {
            throw new UnsupportedOperationException("Synchronous reads only");
        }
    }

    /** Tightest applicable cap wins: credential routes, then assistant, then the global ceiling. */
    static long capFor(String uri) {
        if (uri != null && TIGHT_AUTH_ROUTES.contains(uri)) {
            return MAX_JSON_BYTES_AUTH;
        }
        if (uri != null && (uri.startsWith("/api/v1/assistant/") || uri.startsWith("/api/v1/thesis/assistant/"))) {
            return MAX_JSON_BYTES_ASSISTANT;
        }
        return MAX_JSON_BYTES_GLOBAL;
    }
}
