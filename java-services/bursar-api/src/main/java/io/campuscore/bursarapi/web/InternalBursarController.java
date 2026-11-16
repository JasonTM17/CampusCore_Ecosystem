package io.campuscore.bursarapi.web;

import io.campuscore.bursarapi.model.StudentAccount;
import io.campuscore.bursarapi.service.BursarService;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Service-to-service surface (X-Bursar-Service-Token gated by
 * InternalTokenFilter). The SIS core calls this to enforce financial holds
 * during course registration — the registrarial-equivalent of a bursar block.
 */
@RestController
@RequestMapping("/internal/bursar")
public class InternalBursarController {

    private final BursarService bursar;

    public InternalBursarController(BursarService bursar) {
        this.bursar = bursar;
    }

    @GetMapping("/holds/{studentId}")
    public Map<String, Object> holds(@PathVariable String studentId) {
        List<Map<String, Object>> active = bursar.activeHoldsFor(studentId).stream()
                .map(MeBursarController::holdDto).toList();
        return Map.of("studentId", studentId, "blocked", !active.isEmpty(), "holds", active);
    }

    /**
     * Bounded account snapshot for service consumers that compose a
     * student-facing tuition answer (e.g. the assistant). Latest 6 invoices
     * only — the full history stays on the student's own /me/bursar surface.
     */
    @GetMapping("/account/{studentId}")
    public Map<String, Object> account(@PathVariable String studentId) {
        StudentAccount account = bursar.accountFor(studentId);
        List<Map<String, Object>> active = bursar.activeHoldsFor(studentId).stream()
                .map(MeBursarController::holdDto).toList();
        List<Map<String, Object>> recent = bursar.invoicesFor(studentId).stream()
                .limit(6)
                .map(i -> Map.<String, Object>of(
                        "id", i.getId(),
                        "term", i.getTerm(),
                        "status", i.getStatus(),
                        "total", i.getTotal(),
                        "paidAmount", bursar.paidAmountFor(i.getId()),
                        "remaining", Math.max(0, i.getTotal() - bursar.paidAmountFor(i.getId())),
                        "dueAt", i.getDueAt() == null ? "" : i.getDueAt().toString()))
                .toList();
        Map<String, Object> dto = new java.util.LinkedHashMap<>();
        dto.put("studentId", account.getStudentId());
        dto.put("balance", account.getBalance());
        dto.put("currency", account.getCurrency());
        dto.put("blocked", !active.isEmpty());
        dto.put("holds", active);
        dto.put("invoices", recent);
        return dto;
    }
}
