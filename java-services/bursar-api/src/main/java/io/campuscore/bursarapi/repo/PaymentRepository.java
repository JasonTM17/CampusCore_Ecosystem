package io.campuscore.bursarapi.repo;

import io.campuscore.bursarapi.model.Payment;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PaymentRepository extends JpaRepository<Payment, String> {
    Optional<Payment> findByIdempotencyKey(String idempotencyKey);
    List<Payment> findByInvoiceId(String invoiceId);
}
