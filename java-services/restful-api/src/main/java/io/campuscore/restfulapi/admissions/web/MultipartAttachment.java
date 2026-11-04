package io.campuscore.restfulapi.admissions.web;

import io.campuscore.restfulapi.web.DomainException;
import java.io.IOException;
import java.util.Base64;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.http.InvalidMediaTypeException;
import org.springframework.http.MediaType;
import org.springframework.web.multipart.MultipartFile;

/**
 * Reads a {@code multipart/form-data} file part into the fields of the existing
 * JSON/base64 attachment request, so the multipart operations run the very same
 * service code (ownership, checksum, size, idempotency, versioning) as the JSON
 * ones. Only the transport differs; the JSON body cap is not touched.
 *
 * <p>Both transports apply the same declared-type allowlist and leading-byte
 * signature checks. The part's file name is reduced to a single display-only
 * segment.
 */
public final class MultipartAttachment {

    /** Same ceiling as the base64 attachment lanes in admissions and careers. */
    public static final int MAX_BYTES = 5 * 1024 * 1024;

    private static final byte[] PDF = {'%', 'P', 'D', 'F'};
    private static final byte[] PNG = {(byte) 0x89, 'P', 'N', 'G'};
    private static final byte[] JPEG = {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF};
    private static final byte[] ZIP = {0x50, 0x4B};
    private static final byte[] OLE = {(byte) 0xD0, (byte) 0xCF, 0x11, (byte) 0xE0};

    private static final String DOCX =
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    private static final String XLSX =
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    private static final String PPTX =
            "application/vnd.openxmlformats-officedocument.presentationml.presentation";

    /** Declared type to required leading bytes; a null signature means no content check. */
    private static final Map<String, byte[]> DOCUMENT_TYPES = Map.of(
            "application/pdf", PDF,
            "image/png", PNG,
            "image/jpeg", JPEG,
            "application/msword", OLE,
            DOCX, ZIP);

    private static final Map<String, byte[]> COURSEWORK_TYPES = Map.of(
            "application/pdf", PDF,
            "image/png", PNG,
            "image/jpeg", JPEG,
            "application/msword", OLE,
            DOCX, ZIP,
            XLSX, ZIP,
            PPTX, ZIP,
            "application/zip", ZIP);

    private static final Set<String> TEXT_TYPES = Set.of("text/plain");

    /** Applicant and candidate documents (admissions, careers). */
    public static final Policy DOCUMENTS = new Policy(DOCUMENT_TYPES, Set.of());

    /** Learning materials and submissions: documents plus spreadsheets, slides, archives and plain text. */
    public static final Policy COURSEWORK = new Policy(COURSEWORK_TYPES, TEXT_TYPES);

    private MultipartAttachment() {
    }

    /** Allowed declared content types for one lane. */
    public record Policy(Map<String, byte[]> signedTypes, Set<String> unsignedTypes) {

        boolean allows(String type) {
            return signedTypes.containsKey(type) || unsignedTypes.contains(type);
        }
    }

    /** A file part reduced to the base64 request fields. */
    public record Payload(String fileName, String contentType, String contentBase64) {
    }

    /** The part must be present and non-empty. */
    public static Payload required(MultipartFile file, Policy policy) {
        Payload payload = optional(file, policy);
        if (payload == null) {
            throw new DomainException(HttpStatus.BAD_REQUEST, "ATTACHMENT_DATA_REQUIRED",
                    "A file part named file is required");
        }
        return payload;
    }

    /** Null when the part is absent or empty; otherwise validated like {@link #required}. */
    public static Payload optional(MultipartFile file, Policy policy) {
        if (file == null || file.isEmpty()) {
            return null;
        }
        if (file.getSize() > MAX_BYTES) {
            throw tooLarge();
        }
        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException exception) {
            throw new DomainException(HttpStatus.BAD_REQUEST, "ATTACHMENT_DATA_INVALID",
                    "The uploaded file could not be read");
        }
        if (bytes.length > MAX_BYTES) {
            throw tooLarge();
        }
        String type = validateContentTypeAndSignature(file.getContentType(), bytes, policy);
        return new Payload(displayName(file.getOriginalFilename()), type,
                Base64.getEncoder().encodeToString(bytes));
    }

    /** Applies the lane allowlist and declared-type signature rule to either upload transport. */
    public static String validateContentTypeAndSignature(String declared, byte[] bytes, Policy policy) {
        String type = normalizedType(declared);
        if (!policy.allows(type)) {
            throw new DomainException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "ATTACHMENT_TYPE_UNSUPPORTED",
                    "This file type is not accepted");
        }
        byte[] signature = policy.signedTypes().get(type);
        if (signature != null && !startsWith(bytes, signature)) {
            throw new DomainException(HttpStatus.BAD_REQUEST, "ATTACHMENT_CONTENT_MISMATCH",
                    "The file content does not match its declared type");
        }
        return type;
    }

    private static DomainException tooLarge() {
        return new DomainException(HttpStatus.BAD_REQUEST, "ATTACHMENT_SIZE_INVALID",
                "Attachment must be 1 byte to 5 MiB");
    }

    private static String normalizedType(String declared) {
        if (declared == null) {
            return "";
        }
        int parameters = declared.indexOf(';');
        String type = parameters < 0 ? declared : declared.substring(0, parameters);
        return type.trim().toLowerCase(Locale.ROOT);
    }

    /**
     * JSON/base64 counterpart of the multipart declared-type checks: the
     * declared type must parse as a media type or the upload is rejected at
     * the boundary. The returned value is the canonical {@code type/subtype}
     * (parameters stripped, lowercased) and defaults to octet-stream when
     * absent, so what is persisted always parses on a later download and
     * always fits the attachment column.
     */
    public static String declaredType(String declared) {
        String normalized = normalizedType(declared);
        if (normalized.isEmpty()) {
            return MediaType.APPLICATION_OCTET_STREAM_VALUE;
        }
        String canonical;
        try {
            canonical = MediaType.parseMediaType(normalized).toString();
        } catch (InvalidMediaTypeException exception) {
            throw new DomainException(HttpStatus.BAD_REQUEST, "ATTACHMENT_TYPE_INVALID",
                    "contentType is not a valid media type");
        }
        if (canonical.length() > 120) {
            throw new DomainException(HttpStatus.BAD_REQUEST, "ATTACHMENT_TYPE_INVALID",
                    "contentType is not a valid media type");
        }
        return canonical;
    }

    /**
     * Read-side counterpart of {@link #declaredType}: a stored value that
     * predates boundary validation, or is otherwise unparseable, degrades to
     * octet-stream instead of failing the whole download.
     */
    public static MediaType downloadType(Object stored) {
        if (stored == null) {
            return MediaType.APPLICATION_OCTET_STREAM;
        }
        try {
            return MediaType.parseMediaType(String.valueOf(stored));
        } catch (InvalidMediaTypeException exception) {
            return MediaType.APPLICATION_OCTET_STREAM;
        }
    }

    /** Single path segment, printable characters only, capped; never used as a storage path. */
    public static String displayName(String original) {
        String name = original == null ? "" : original;
        int slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
        if (slash >= 0) {
            name = name.substring(slash + 1);
        }
        StringBuilder cleaned = new StringBuilder();
        for (char candidate : name.toCharArray()) {
            if (candidate >= 32 && candidate != 127 && candidate != '"' && candidate != '<'
                    && candidate != '>' && cleaned.length() < 200) {
                cleaned.append(candidate);
            }
        }
        String result = cleaned.toString().trim();
        return result.isEmpty() ? "attachment" : result;
    }

    private static boolean startsWith(byte[] data, byte[] prefix) {
        if (data.length < prefix.length) {
            return false;
        }
        for (int index = 0; index < prefix.length; index++) {
            if (data[index] != prefix[index]) {
                return false;
            }
        }
        return true;
    }
}
