package io.campuscore.bursarapi.repo;

import io.campuscore.bursarapi.model.InvoiceItem;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InvoiceItemRepository extends JpaRepository<InvoiceItem, String> {
    List<InvoiceItem> findByInvoiceIdIn(List<String> invoiceIds);
}
