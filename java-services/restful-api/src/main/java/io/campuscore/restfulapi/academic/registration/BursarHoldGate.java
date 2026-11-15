package io.campuscore.restfulapi.academic.registration;

import io.campuscore.restfulapi.web.DomainException;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * Enforces the bursar's financial-hold check before an enrollment mutates.
 * Universities block registration while a student carries an active hold;
 * the authoritative record lives in bursar-api, reached over the internal
 * token-gated endpoint. When the service is unreachable the gate fails open
 * and warns — registration availability wins over strictness locally.
 */
@Component
public class BursarHoldGate {

    public static final String HEADER = "X-Bursar-Service-Token";

    private static final Logger log = LoggerFactory.getLogger(BursarHoldGate.class);

    private final boolean enforcement;
    private final String internalToken;
    private final RestClient client;

    public BursarHoldGate(
            @Value("${bursar.enforcement:false}") boolean enforcement,
            @Value("${bursar.base-url:}") String baseUrl,
            @Value("${bursar.internal-token:}") String internalToken,
            @Value("${bursar.timeout-ms:2000}") int timeoutMs) {
        this.enforcement = enforcement;
        this.internalToken = internalToken == null ? "" : internalToken;
        if (enforcement && baseUrl != null && !baseUrl.isBlank()) {
            SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
            factory.setConnectTimeout(timeoutMs);
            factory.setReadTimeout(timeoutMs);
            this.client = RestClient.builder()
                    .requestFactory(factory)
                    .baseUrl(baseUrl)
                    .build();
        } else {
            this.client = null;
            if (enforcement) {
                log.warn("BURSAR_GATE_DISABLED bursar.enforcement=true but bursar.base-url is blank");
            }
        }
    }

    /** No-op gate for unit tests that construct the service directly. */
    public static BursarHoldGate disabled() {
        return new BursarHoldGate(false, "", "", 0);
    }

    /** Throws 409 TUITION_HOLD when the bursar reports an active hold. */
    public void assertEnrollable(String studentId) {
        if (!enforcement || client == null || internalToken.isBlank()) {
            return;
        }
        HoldsResponse holds;
        try {
            holds = client.get()
                    .uri("/internal/bursar/holds/{studentId}", studentId)
                    .header(HEADER, internalToken)
                    .retrieve()
                    .body(HoldsResponse.class);
        } catch (RuntimeException ex) {
            log.warn("BURSAR_GATE_FAIL_OPEN studentId={} reason={}", studentId, ex.getClass().getSimpleName());
            return;
        }
        if (holds != null && holds.blocked()) {
            throw new DomainException(
                    HttpStatus.CONFLICT,
                    "TUITION_HOLD",
                    "Student has an active financial hold; contact the bursar's office");
        }
    }

    /** Mirror of bursar-api's InternalBursarController response. */
    private record HoldsResponse(String studentId, boolean blocked, List<Map<String, Object>> holds) {
    }
}
