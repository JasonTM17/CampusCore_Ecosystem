package io.campuscore.restfulapi.attendance;

import static org.assertj.core.api.Assertions.assertThat;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

class GeofenceVerifierTest {
    private final Instant now=Instant.parse("2026-10-29T03:00:00Z");
    private final GeofenceVerifier verifier=new GeofenceVerifier(Clock.fixed(now,ZoneOffset.UTC));
    private GeofenceVerifier.Verdict verify(double lat,double lng,double accuracy,Instant at) {
        return verifier.verify(lat,lng,accuracy,at,10,106,150);
    }
    @Test void insideAccurateFixAccepted() { assertThat(verify(10,106,5,now).decision()).isEqualTo("ACCEPTED"); }
    @Test void outsideFixRejected() { assertThat(verify(11,106,5,now).reason()).isEqualTo("OUTSIDE_AREA"); }
    @Test void overlapAtBoundaryRequiresReview() { assertThat(verify(10.0015,106,30,now).reason()).isEqualTo("BORDERLINE"); }
    @Test void accuracyBetweenFiftyAndHundredRequiresReview() {
        assertThat(verify(10,106,50,now).decision()).isEqualTo("ACCEPTED");
        assertThat(verify(10,106,50.1,now).reason()).isEqualTo("BORDERLINE");
        assertThat(verify(10,106,100,now).reason()).isEqualTo("BORDERLINE");
        assertThat(verify(10,106,100.1,now).reason()).isEqualTo("LOW_ACCURACY");
    }
    @Test void nonFiniteOutOfRangeAndNegativeAccuracyRejected() {
        for(double[] point:new double[][]{{Double.NaN,0},{Double.POSITIVE_INFINITY,0},{91,0},{0,181}})
            assertThat(verify(point[0],point[1],1,now).reason()).isEqualTo("INVALID_LOCATION");
        for(double accuracy:new double[]{Double.NaN,Double.NEGATIVE_INFINITY,-1})
            assertThat(verify(10,106,accuracy,now).reason()).isEqualTo("INVALID_LOCATION");
    }
    @Test void timestampFreshnessIncludesExactBoundaries() {
        assertThat(verify(10,106,1,now.minusSeconds(60)).decision()).isEqualTo("ACCEPTED");
        assertThat(verify(10,106,1,now.plusSeconds(10)).decision()).isEqualTo("ACCEPTED");
        assertThat(verify(10,106,1,now.minusSeconds(61)).reason()).isEqualTo("INVALID_LOCATION");
        assertThat(verify(10,106,1,now.plusSeconds(11)).reason()).isEqualTo("INVALID_LOCATION");
        assertThat(verify(10,106,1,null).reason()).isEqualTo("INVALID_LOCATION");
    }
    @Test void antimeridianAndPolesHaveFiniteShortDistances() {
        assertThat(GeofenceVerifier.distance(0,179.9999,0,-179.9999)).isBetween(20.0,23.0);
        assertThat(GeofenceVerifier.distance(90,180,90,-180)).isLessThan(0.001);
        assertThat(GeofenceVerifier.distance(0,0,0,180)).isBetween(20_000_000.0,20_100_000.0);
        assertThat(verifier.verify(0,-179.9999,1,now,0,179.9999,150).decision()).isEqualTo("ACCEPTED");
    }
}
