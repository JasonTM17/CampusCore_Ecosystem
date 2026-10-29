package io.campuscore.restfulapi.attendance;

import static org.assertj.core.api.Assertions.*;
import java.time.Instant;
import org.junit.jupiter.api.Test;

class RiskEvaluatorTest {
    private final RiskEvaluator risk=new RiskEvaluator(CodeServiceTest.properties());
    private final RiskEvaluator.Position here=new RiskEvaluator.Position(10,106,Instant.parse("2026-10-29T03:00:00Z"));
    @Test void ordinaryFixHasNoRisk() { assertThat(risk.evaluate(false,5,here,null,false,2)).isEmpty(); }
    @Test void everyAdvisorySignalIsReturned() {
        var previous=new RiskEvaluator.Position(11,106,here.capturedAt().minusSeconds(10));
        assertThat(risk.evaluate(true,0,here,previous,true,3))
                .containsExactly("SHARED_DEVICE","MOCK_PROVIDER","ZERO_ACCURACY","IDENTICAL_COORDINATES","IMPOSSIBLE_SPEED");
    }
    @Test void backwardsTimeWithMovementIsSuspiciousButStationaryFixIsNot() {
        assertThat(risk.evaluate(false,5,here,new RiskEvaluator.Position(11,106,here.capturedAt()),false,0)).contains("IMPOSSIBLE_SPEED");
        assertThat(risk.evaluate(false,5,here,here,false,0)).isEmpty();
    }
    @Test void hashIsStablePepperedAndDomainSeparated() {
        assertThat(risk.hash("device","a")).hasSize(64).isEqualTo(risk.hash("device","a"))
                .isNotEqualTo(risk.hash("ip","a")).isNotEqualTo(risk.hash("device","b"));
        var p=CodeServiceTest.properties();p.setPepper("different-pepper-with-at-least-32-characters");
        assertThat(new RiskEvaluator(p).hash("device","a")).isNotEqualTo(risk.hash("device","a"));
        assertThatThrownBy(()->new RiskEvaluator(new AttendanceCheckinProperties()).hash("ip","a"))
                .isInstanceOf(io.campuscore.restfulapi.web.DomainException.class);
    }
}
