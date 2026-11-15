package io.campuscore.bursarapi.repo;

import io.campuscore.bursarapi.model.StudentAccount;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface StudentAccountRepository extends JpaRepository<StudentAccount, String> {
    Optional<StudentAccount> findByStudentId(String studentId);
}
