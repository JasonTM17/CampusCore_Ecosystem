package io.campuscore.bursarapi.repo;

import io.campuscore.bursarapi.model.Invoice;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InvoiceRepository extends JpaRepository<Invoice, String> {
    List<Invoice> findByStudentIdOrderByIssuedAtDesc(String studentId);
    Optional<Invoice> findByIdAndStudentId(String id, String studentId);
}
