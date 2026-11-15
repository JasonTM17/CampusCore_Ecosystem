package io.campuscore.bursarapi.repo;

import io.campuscore.bursarapi.model.FeeRate;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface FeeRateRepository extends JpaRepository<FeeRate, String> {
    List<FeeRate> findByAcademicYearOrderByDepartmentCodeAsc(String academicYear);
}
