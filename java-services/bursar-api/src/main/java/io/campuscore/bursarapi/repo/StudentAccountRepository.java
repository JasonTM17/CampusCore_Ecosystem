package io.campuscore.bursarapi.repo;

import io.campuscore.bursarapi.model.StudentAccount;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;

public interface StudentAccountRepository extends JpaRepository<StudentAccount, String> {

    // Locked alongside the invoice during pay() so concurrent payments cannot
    // lose each other's balance decrement.
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<StudentAccount> findByStudentId(String studentId);
}
