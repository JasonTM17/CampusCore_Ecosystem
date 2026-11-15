package io.campuscore.bursarapi.web;

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
}
