package io.campuscore.bursarapi.web;

import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/health")
public class HealthController {

    @GetMapping("/liveness")
    public Map<String, String> liveness() {
        return Map.of("status", "UP");
    }
}
