package io.campuscore.bursarapi.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import io.campuscore.bursarapi.model.FinancialHold;
import io.campuscore.bursarapi.model.Invoice;
import io.campuscore.bursarapi.model.StudentAccount;
import io.campuscore.bursarapi.service.BursarService;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class InternalBursarControllerTest {

    private final BursarService bursar = mock(BursarService.class);
    private final InternalBursarController controller = new InternalBursarController(bursar);

    @Test
    @SuppressWarnings("unchecked")
    void accountReturnsBalanceHoldsAndBoundedInvoices() {
        when(bursar.accountFor("stu-1")).thenReturn(new StudentAccount("acct-1", "stu-1"));
        when(bursar.activeHoldsFor("stu-1"))
                .thenReturn(List.of(new FinancialHold("hold-1", "stu-1", "OVERDUE_TUITION")));
        Invoice open = new Invoice("inv-1", "stu-1", "2026HK1", 18_620_000L);
        open.setStatus("OPEN");
        open.setDueAt(Instant.parse("2026-09-15T00:00:00Z"));
        Invoice paid = new Invoice("inv-0", "stu-1", "2025HK3", 5_000_000L);
        paid.setStatus("PAID");
        when(bursar.invoicesFor("stu-1")).thenReturn(List.of(open, paid));
        when(bursar.paidAmountFor("inv-1")).thenReturn(4_000_000L);
        when(bursar.paidAmountFor("inv-0")).thenReturn(5_000_000L);

        Map<String, Object> dto = controller.account("stu-1");

        assertEquals("stu-1", dto.get("studentId"));
        assertEquals("VND", dto.get("currency"));
        assertTrue((Boolean) dto.get("blocked"));
        assertEquals(1, ((List<Map<String, Object>>) dto.get("holds")).size());

        List<Map<String, Object>> invoices = (List<Map<String, Object>>) dto.get("invoices");
        assertEquals(2, invoices.size());
        assertEquals("inv-1", invoices.get(0).get("id"));
        assertEquals(18_620_000L, invoices.get(0).get("total"));
        assertEquals(4_000_000L, invoices.get(0).get("paidAmount"));
        assertEquals(14_620_000L, invoices.get(0).get("remaining"));
        assertEquals("2026-09-15T00:00:00Z", invoices.get(0).get("dueAt"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void accountLimitsInvoicesToSixMostRecent() {
        when(bursar.accountFor("stu-1")).thenReturn(new StudentAccount("acct-1", "stu-1"));
        when(bursar.activeHoldsFor("stu-1")).thenReturn(List.of());
        java.util.List<Invoice> many = new java.util.ArrayList<>();
        for (int i = 0; i < 9; i++) {
            many.add(new Invoice("inv-" + i, "stu-1", "term-" + i, 1_000L));
        }
        when(bursar.invoicesFor("stu-1")).thenReturn(many);

        Map<String, Object> dto = controller.account("stu-1");

        assertFalse((Boolean) dto.get("blocked"));
        assertEquals(6, ((List<Map<String, Object>>) dto.get("invoices")).size());
    }
}
