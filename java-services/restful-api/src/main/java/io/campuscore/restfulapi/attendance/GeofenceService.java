package io.campuscore.restfulapi.attendance;

import static io.campuscore.restfulapi.attendance.AttendanceDtos.*;
import io.campuscore.restfulapi.audit.AdminAuditRecorder;
import java.time.Clock;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Profile("persistence")
public class GeofenceService {
    private final AttendanceStore store;
    private final AdminAuditRecorder audit;
    private final Clock clock;
    public GeofenceService(AttendanceStore store,AdminAuditRecorder audit,@Qualifier("attendanceClock") Clock clock) {
        this.store=store;this.audit=audit;this.clock=clock;
    }
    @Transactional(readOnly=true)
    public List<GeofenceResponse> list() { return store.geofences(); }
    @Transactional(readOnly=true)
    public List<ActiveGeofenceResponse> listActive() { return store.activeGeofences(); }
    @Transactional
    public GeofenceResponse save(String id,GeofenceRequest r,String actor) {
        if(!GeofenceVerifier.coordinate(r.centerLat(),r.centerLng()) || r.radiusMeters()<30 || r.radiusMeters()>1000)
            throw SessionService.failure(org.springframework.http.HttpStatus.BAD_REQUEST,"INVALID_GEOFENCE");
        boolean create=id==null;
        if(create) id=UUID.randomUUID().toString();
        GeofenceResponse before=create?null:store.geofence(id,true);
        store.saveGeofence(id,r,actor,create,clock.instant());
        GeofenceResponse after=store.geofence(id,false);
        audit.record(actor,null,create?"CREATED":"UPDATED","AttendanceGeofence",id,
                r.isActive()?"Geofence enabled/updated after admin verification":"Geofence saved inactive",before,after);
        return after;
    }
    // There is deliberately no hard-delete route. PUT isActive=false preserves references and audit.
}
