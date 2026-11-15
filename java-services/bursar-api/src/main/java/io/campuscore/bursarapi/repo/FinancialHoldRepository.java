package io.campuscore.bursarapi.repo;

import io.campuscore.bursarapi.model.FinancialHold;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface FinancialHoldRepository extends JpaRepository<FinancialHold, String> {
    List<FinancialHold> findByStudentIdAndStatus(String studentId, String status);
}
