package io.campuscore.restfulapi.thesis.assistant;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * Read-side bridge from the assistant's personal-context advisor to
 * bursar-api. Personal tuition questions ("tôi còn nợ học phí bao nhiêu")
 * need the asker's own account snapshot, which lives behind the same
 * internal token-gated surface the registration hold gate uses.
 *
 * Fail-open by design: when the bursar service is unreachable the advisor
 * falls back to the knowledge path, so an unrelated outage can never turn a
 * policy question into an error.
 */
@Component
public class BursarAssistantGateway {

    private static final Logger log = LoggerFactory.getLogger(BursarAssistantGateway.class);

    private final String internalToken;
    private final RestClient client;

    public BursarAssistantGateway(
            @Value("${bursar.base-url:}") String baseUrl,
            @Value("${bursar.internal-token:}") String internalToken,
            @Value("${bursar.timeout-ms:2000}") int timeoutMs) {
        this.internalToken = internalToken == null ? "" : internalToken;
        if (baseUrl != null && !baseUrl.isBlank()) {
            SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
            factory.setConnectTimeout(timeoutMs);
            factory.setReadTimeout(timeoutMs);
            this.client = RestClient.builder()
                    .requestFactory(factory)
                    .baseUrl(baseUrl)
                    .build();
        } else {
            this.client = null;
        }
    }

    /** Test hook: advisor paths that never touch bursar keep this disabled. */
    public static BursarAssistantGateway disabled() {
        return new BursarAssistantGateway("", "", 0);
    }

    /** Account snapshot for the asker; empty when the service is down or unconfigured. */
    public Optional<BursarAccountView> accountFor(String studentId) {
        if (client == null || internalToken.isBlank() || studentId == null || studentId.isBlank()) {
            return Optional.empty();
        }
        try {
            AccountResponse response = client.get()
                    .uri("/internal/bursar/account/{studentId}", studentId)
                    .header(io.campuscore.restfulapi.academic.registration.BursarHoldGate.HEADER, internalToken)
                    .retrieve()
                    .body(AccountResponse.class);
            if (response == null) {
                return Optional.empty();
            }
            return Optional.of(new BursarAccountView(
                    response.balance(),
                    response.currency(),
                    response.blocked(),
                    response.holds() == null ? List.of() : response.holds(),
                    response.invoices() == null ? List.of() : response.invoices()));
        } catch (RuntimeException ex) {
            log.warn("BURSAR_ASSISTANT_FAIL_OPEN studentId={} reason={}",
                    studentId, ex.getClass().getSimpleName());
            return Optional.empty();
        }
    }

    public record BursarAccountView(
            long balance,
            String currency,
            boolean blocked,
            List<Map<String, Object>> holds,
            List<Map<String, Object>> invoices) { }

    /** Wire shape of GET /internal/bursar/account/{studentId}. */
    public record AccountResponse(
            String studentId,
            long balance,
            String currency,
            boolean blocked,
            List<Map<String, Object>> holds,
            List<Map<String, Object>> invoices) { }
}
