package io.campuscore.restfulapi.admissions.web;

import io.campuscore.restfulapi.web.DomainException;
import java.io.IOException;
import java.util.Base64;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.web.multipart.MultipartFile;

/**
 * Reads a {@code multipart/form-data} file part into the fields of the existing
 * JSON/base64 attachment request, so the multipart operations run the very same
 * service code (ownership, checksum, size, idempotency, versioning) as the JSON
 * ones. Only the transport differs; the JSON body cap is not touched.
 *
 * <p>The multipart lane additionally refuses a declared content type outside
 * the policy allowlist and a body whose leading bytes contradict the declared
 * type. The part's file name is reduced to a single display-only segment.
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
        String type = normalizedType(file.getContentType());
        if (!policy.allows(type)) {
            throw new DomainException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "ATTACHMENT_TYPE_UNSUPPORTED",
                    "This file type is not accepted");
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
        byte[] signature = policy.signedTypes().get(type);
        if (signature != null && !startsWith(bytes, signature)) {
            throw new DomainException(HttpStatus.BAD_REQUEST, "ATTACHMENT_CONTENT_MISMATCH",
                    "The file content does not match its declared type");
        }
        return new Payload(displayName(file.getOriginalFilename()), type,
                Base64.getEncoder().encodeToString(bytes));
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

    /** Single path segment, printable characters only, capped; never used as a storage path. */
    static String displayName(String original) {
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
