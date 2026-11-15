package io.campuscore.bursarapi.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "invoice_item", schema = "bursar")
public class InvoiceItem {

    @Id
    @Column(name = "id")
    private String id;

    @Column(name = "invoice_id", nullable = false)
    private String invoiceId;

    @Column(name = "label", nullable = false)
    private String label;

    @Column(name = "course_code")
    private String courseCode;

    @Column(name = "credits", nullable = false)
    private int credits;

    @Column(name = "unit_price", nullable = false)
    private long unitPrice;

    @Column(name = "amount", nullable = false)
    private long amount;

    protected InvoiceItem() {
    }

    public InvoiceItem(String id, String invoiceId, String label, String courseCode,
            int credits, long unitPrice) {
        this.id = id;
        this.invoiceId = invoiceId;
        this.label = label;
        this.courseCode = courseCode;
        this.credits = credits;
        this.unitPrice = unitPrice;
        this.amount = (long) credits * unitPrice;
    }

    public String getId() {
        return id;
    }

    public String getInvoiceId() {
        return invoiceId;
    }

    public String getLabel() {
        return label;
    }

    public String getCourseCode() {
        return courseCode;
    }

    public int getCredits() {
        return credits;
    }

    public long getUnitPrice() {
        return unitPrice;
    }

    public long getAmount() {
        return amount;
    }
}
