package io.campuscore.bursarapi.repo;

import io.campuscore.bursarapi.model.Invoice;
import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;

public interface InvoiceRepository extends JpaRepository<Invoice, String> {
    List<Invoice> findByStudentIdOrderByIssuedAtDesc(String studentId);

    Optional<Invoice> findByIdAndStudentId(String id, String studentId);

    // Serialized per invoice inside the payment transaction so concurrent pays
    // cannot both commit against a stale total. "ForUpdate" lives before the By
    // clause so the derived-name parser does not read it as a property. Lock-
    // qualified reads must stay inside @Transactional — plain GET paths use the
    // unlocked variant above.
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<Invoice> findForUpdateByIdAndStudentId(String id, String studentId);
}
