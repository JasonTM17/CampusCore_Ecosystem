/**
 * Shared HTML content for the academic editor's seed documents, institutional
 * content blocks, and template library.
 *
 * Only the raw HTML bodies live here. User-facing block labels, template
 * names, and seed document titles are localized in `src/i18n/messages-editor.ts`.
 */

export const EDITOR_BLOCK_TYPES = [
  'header',
  'recipient',
  'summary',
  'table',
  'clauses',
  'notice',
  'signoff',
] as const;

export type EditorBlockType = (typeof EDITOR_BLOCK_TYPES)[number];

export const EDITOR_BLOCK_HTML: Record<EditorBlockType, string> = {
  header: `  <div style="text-align: center; border-bottom: 2px solid #0284c7; padding-bottom: 12px; margin-bottom: 20px;">
    <h4 style="margin: 0; text-transform: uppercase; color: #64748b; font-size: 13px; letter-spacing: 1px;">TRƯỜNG ĐẠI HỌC CÔNG NGHỆ KỸ THUẬT TP.HCM</h4>
    <h2 style="margin: 8px 0 0 0; color: #0f172a; font-size: 22px; font-weight: 700;">THÔNG BÁO HỌC VỤ & HƯỚNG DẪN ĐÀO TẠO</h2>
    <p style="margin: 4px 0 0 0; color: #64748b; font-size: 13px;">[Học kỳ ... - Năm học ...] | [Đơn vị ban hành]</p>
  </div>`,
  recipient: `  <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 14px 18px; border-radius: 6px; margin-bottom: 20px;">
    <strong style="color: #1d4ed8; font-size: 14px;">Kính gửi:</strong> Toàn thể Giảng viên, Cán bộ học vụ và Sinh viên hệ đào tạo chính quy.
  </div>`,
  summary: `  <h3 style="color: #0369a1; font-size: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">1. Kế hoạch đào tạo & Đăng ký tín chỉ</h3>
  <p>Nhà trường thông báo kế hoạch tổ chức học vụ và thời gian mở cổng đăng ký tín chỉ học phần đợt mới:</p>`,
  table: `  <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
    <thead>
      <tr style="background-color: #f1f5f9; text-align: left;">
        <th style="border: 1px solid #cbd5e1; padding: 10px; font-weight: 600;">Đợt đăng ký</th>
        <th style="border: 1px solid #cbd5e1; padding: 10px; font-weight: 600;">Thời gian bắt đầu</th>
        <th style="border: 1px solid #cbd5e1; padding: 10px; font-weight: 600;">Thời gian kết thúc</th>
        <th style="border: 1px solid #cbd5e1; padding: 10px; font-weight: 600;">Đối tượng</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">Đợt 1</td>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">[HH:mm - dd/mm/yyyy]</td>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">[HH:mm - dd/mm/yyyy]</td>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">[Đối tượng sinh viên]</td>
      </tr>
      <tr>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">Đợt 2</td>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">[HH:mm - dd/mm/yyyy]</td>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">[HH:mm - dd/mm/yyyy]</td>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">[Đối tượng sinh viên]</td>
      </tr>
    </tbody>
  </table>`,
  clauses: `  <div style="margin-bottom: 20px;">
    <h3 style="color: #0369a1; font-size: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">2. Quy định thực hiện và Hạn mức tín chỉ</h3>
    <p><strong>- Hạn mức tín chỉ:</strong> Sinh viên đăng ký theo hạn mức quy định trong quy chế hiện hành. Việc đăng ký vượt hạn mức chỉ được chấp nhận khi có đơn và được Phòng Đào tạo phê duyệt.</p>
    <p><strong>- Hủy học phần:</strong> Thời hạn xin rút/hủy học phần kết thúc vào tuần thứ 2 kể từ ngày bắt đầu học kỳ.</p>
  </div>`,
  notice: `  <div style="background-color: #fefce8; border-left: 4px solid #eab308; padding: 14px 18px; border-radius: 6px; margin-bottom: 20px;">
    <strong style="color: #a16207;">Lưu ý quan trọng:</strong> Sinh viên kiểm tra điều kiện tiên quyết và lịch học trước khi xác nhận. Mọi thắc mắc liên hệ Phòng Đào tạo (P. A1-201) trong giờ hành chính.
  </div>`,
  signoff: `  <table style="width: 100%; margin-top: 32px; border: none;">
    <tr>
      <td style="width: 50%; vertical-align: top; border: none;">
        <p style="font-size: 12px; margin: 0; line-height: 1.6; color: #64748b;">
          <strong><em>Nơi nhận:</em></strong><br/>
          - Như kính gửi;<br/>
          - Ban Giám hiệu (để b/c);<br/>
          - Phòng Đào tạo, VP các Khoa;<br/>
          - Lưu: VT, CTSV.
        </p>
      </td>
      <td style="width: 50%; text-align: right; vertical-align: top; border: none;">
        <p style="font-weight: bold; margin: 0; text-transform: uppercase; font-size: 13px; color: #334155;">HIỆU TRƯỞNG</p>
        <div style="display: inline-block; margin: 8px 0; padding: 4px 12px; border: 2px dashed #dc2626; border-radius: 6px; background-color: #fef2f2; color: #b91c1c; font-size: 11px; font-weight: bold; text-align: center;">
          [CHỖ KÝ SỐ / CON DẤU ĐIỆN TỬ E-OFFICE]
        </div>
        <p style="font-weight: bold; margin: 4px 0 0 0; color: #0284c7; font-size: 14px;">[Họ tên &amp; học hàm người ký]</p>
      </td>
    </tr>
  </table>`,
};

/**
 * English bodies for the seven block-builder inserts. The Vietnamese map above
 * stays the default so existing drafts render byte-identically; callers pick a
 * locale with `getEditorBlockHtml`.
 */
export const EDITOR_BLOCK_HTML_EN: Record<EditorBlockType, string> = {
  header: `  <div style="text-align: center; border-bottom: 2px solid #0284c7; padding-bottom: 12px; margin-bottom: 20px;">
    <h4 style="margin: 0; text-transform: uppercase; color: #64748b; font-size: 13px; letter-spacing: 1px;">HCMC UNIVERSITY OF TECHNOLOGY AND ENGINEERING</h4>
    <h2 style="margin: 8px 0 0 0; color: #0f172a; font-size: 22px; font-weight: 700;">ACADEMIC NOTICE & ACADEMIC AFFAIRS GUIDELINES</h2>
    <p style="margin: 4px 0 0 0; color: #64748b; font-size: 13px;">[Term ... - Academic Year ...] | [Issuing office]</p>
  </div>`,
  recipient: `  <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 14px 18px; border-radius: 6px; margin-bottom: 20px;">
    <strong style="color: #1d4ed8; font-size: 14px;">Attention:</strong> All Faculty Members, Academic Affairs Staff, and full-time students.
  </div>`,
  summary: `  <h3 style="color: #0369a1; font-size: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">1. Academic Plan & Course Credit Registration</h3>
  <p>The University announces the academic plan and the opening time of the course-credit registration portal for the new term:</p>`,
  table: `  <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
    <thead>
      <tr style="background-color: #f1f5f9; text-align: left;">
        <th style="border: 1px solid #cbd5e1; padding: 10px; font-weight: 600;">Batch</th>
        <th style="border: 1px solid #cbd5e1; padding: 10px; font-weight: 600;">Start Time</th>
        <th style="border: 1px solid #cbd5e1; padding: 10px; font-weight: 600;">End Time</th>
        <th style="border: 1px solid #cbd5e1; padding: 10px; font-weight: 600;">Target Cohort</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">Phase 1</td>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">[HH:mm - Mon DD, YYYY]</td>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">[HH:mm - Mon DD, YYYY]</td>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">[Target cohort]</td>
      </tr>
      <tr>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">Phase 2</td>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">[HH:mm - Mon DD, YYYY]</td>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">[HH:mm - Mon DD, YYYY]</td>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">[Target cohort]</td>
      </tr>
    </tbody>
  </table>`,
  clauses: `  <div style="margin-bottom: 20px;">
    <h3 style="color: #0369a1; font-size: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">2. Implementation Rules and Credit Limits</h3>
    <p><strong>- Credit limits:</strong> Students register within the limits set by the current academic regulations. Registration above the limit is accepted only with a written request approved by the Office of Academic Affairs.</p>
    <p><strong>- Course withdrawal:</strong> The withdrawal/cancellation window closes at the end of the second week from the start of the term.</p>
  </div>`,
  notice: `  <div style="background-color: #fefce8; border-left: 4px solid #eab308; padding: 14px 18px; border-radius: 6px; margin-bottom: 20px;">
    <strong style="color: #a16207;">Important note:</strong> Students must check the prerequisite requirements and their class schedule before confirming. For any questions, contact the Office of Academic Affairs (Room A1-201) during office hours.
  </div>`,
  signoff: `  <table style="width: 100%; margin-top: 32px; border: none;">
    <tr>
      <td style="width: 50%; vertical-align: top; border: none;">
        <p style="font-size: 12px; margin: 0; line-height: 1.6; color: #64748b;">
          <strong><em>Recipients:</em></strong><br/>
          - As addressed above;<br/>
          - Board of Rectors (for reporting);<br/>
          - Office of Academic Affairs, Faculty Offices;<br/>
          - Filed: Secretariat, Student Affairs.
        </p>
      </td>
      <td style="width: 50%; text-align: right; vertical-align: top; border: none;">
        <p style="font-weight: bold; margin: 0; text-transform: uppercase; font-size: 13px; color: #334155;">RECTOR</p>
        <div style="display: inline-block; margin: 8px 0; padding: 4px 12px; border: 2px dashed #dc2626; border-radius: 6px; background-color: #fef2f2; color: #b91c1c; font-size: 11px; font-weight: bold; text-align: center;">
          [E-OFFICE DIGITAL SIGNATURE / SEAL PLACEHOLDER]
        </div>
        <p style="font-weight: bold; margin: 4px 0 0 0; color: #0284c7; font-size: 14px;">[Signatory name &amp; academic title]</p>
      </td>
    </tr>
  </table>`,
};

/** Locale selector for the block-builder HTML bodies. */
export function getEditorBlockHtml(type: EditorBlockType, isVi: boolean): string {
  return isVi ? EDITOR_BLOCK_HTML[type] : EDITOR_BLOCK_HTML_EN[type];
}

/** Default TinyMCE seed document, one entry per locale. */
export const EDITOR_SEED_HTML = {
  vi: `
<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b;">
  <div style="text-align: center; border-bottom: 2px solid #0284c7; padding-bottom: 12px; margin-bottom: 20px;">
    <h4 style="margin: 0; text-transform: uppercase; color: #64748b; font-size: 13px; letter-spacing: 1px;">TRƯỜNG ĐẠI HỌC CÔNG NGHỆ KỸ THUẬT TP.HCM</h4>
    <h2 style="margin: 8px 0 0 0; color: #0f172a; font-size: 22px; font-weight: 700;">THÔNG BÁO HỌC VỤ & HƯỚNG DẪN ĐÀO TẠO</h2>
    <p style="margin: 4px 0 0 0; color: #64748b; font-size: 13px;">[Học kỳ ... - Năm học ...] | [Đơn vị ban hành]</p>
  </div>

  <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 14px 18px; border-radius: 6px; margin-bottom: 20px;">
    <strong style="color: #1d4ed8; font-size: 14px;">Kính gửi:</strong> Toàn thể Giảng viên, Cán bộ học vụ và Sinh viên hệ đào tạo chính quy.
  </div>

  <h3 style="color: #0369a1; font-size: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">1. Kế hoạch đào tạo & Đăng ký tín chỉ</h3>
  <p>Nhà trường thông báo kế hoạch tổ chức học vụ và thời gian mở cổng đăng ký tín chỉ học phần đợt mới:</p>

  <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
    <thead>
      <tr style="background-color: #f1f5f9; text-align: left;">
        <th style="border: 1px solid #cbd5e1; padding: 10px; font-weight: 600;">Đợt đăng ký</th>
        <th style="border: 1px solid #cbd5e1; padding: 10px; font-weight: 600;">Thời gian bắt đầu</th>
        <th style="border: 1px solid #cbd5e1; padding: 10px; font-weight: 600;">Thời gian kết thúc</th>
        <th style="border: 1px solid #cbd5e1; padding: 10px; font-weight: 600;">Đối tượng</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">Đợt 1</td>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">[HH:mm - dd/mm/yyyy]</td>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">[HH:mm - dd/mm/yyyy]</td>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">[Đối tượng sinh viên]</td>
      </tr>
      <tr>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">Đợt 2</td>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">[HH:mm - dd/mm/yyyy]</td>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">[HH:mm - dd/mm/yyyy]</td>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">[Đối tượng sinh viên]</td>
      </tr>
    </tbody>
  </table>

  <div style="background-color: #fefce8; border-left: 4px solid #eab308; padding: 14px 18px; border-radius: 6px; margin-bottom: 20px;">
    <strong style="color: #a16207;">Lưu ý quan trọng:</strong> Sinh viên kiểm tra điều kiện tiên quyết và lịch học trước khi xác nhận.
  </div>
</div>
`,
  en: `
<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b;">
  <div style="text-align: center; border-bottom: 2px solid #0284c7; padding-bottom: 12px; margin-bottom: 20px;">
    <h4 style="margin: 0; text-transform: uppercase; color: #64748b; font-size: 13px; letter-spacing: 1px;">HCMC UNIVERSITY OF TECHNOLOGY AND ENGINEERING</h4>
    <h2 style="margin: 8px 0 0 0; color: #0f172a; font-size: 22px; font-weight: 700;">ACADEMIC NOTICE & GOVERNANCE POLICY</h2>
    <p style="margin: 4px 0 0 0; color: #64748b; font-size: 13px;">[Term ... - Academic Year ...] | [Issuing office]</p>
  </div>

  <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 14px 18px; border-radius: 6px; margin-bottom: 20px;">
    <strong style="color: #1d4ed8; font-size: 14px;">Attention:</strong> All Faculty Members, Academic Staff, and Enrolled Students.
  </div>

  <h3 style="color: #0369a1; font-size: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">1. Course Registration Milestones</h3>
  <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
    <thead>
      <tr style="background-color: #f1f5f9; text-align: left;">
        <th style="border: 1px solid #cbd5e1; padding: 10px; font-weight: 600;">Batch</th>
        <th style="border: 1px solid #cbd5e1; padding: 10px; font-weight: 600;">Start Time</th>
        <th style="border: 1px solid #cbd5e1; padding: 10px; font-weight: 600;">End Time</th>
        <th style="border: 1px solid #cbd5e1; padding: 10px; font-weight: 600;">Target Cohort</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">Phase 1</td>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">[HH:mm - Mon DD, YYYY]</td>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">[HH:mm - Mon DD, YYYY]</td>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">[Target cohort]</td>
      </tr>
      <tr>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">Phase 2</td>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">[HH:mm - Mon DD, YYYY]</td>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">[HH:mm - Mon DD, YYYY]</td>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">[Target cohort]</td>
      </tr>
    </tbody>
  </table>
</div>
`,
} as const;

/** Default Markdown seed document. */
export const EDITOR_SEED_MARKDOWN = `# ĐỀ CƯƠNG HỌC PHẦN & TÀI LIỆU HƯỚNG DẪN

> [!NOTE]
> Tài liệu này được soạn thảo trực tiếp trên **Trình soạn thảo học vụ CampusUTE**. Hỗ trợ bảng biểu, công thức, mã nguồn và hộp cảnh báo chuẩn institutional.

### 1. Mục tiêu và Chuẩn đầu ra (CLO)
- [ ] Nắm vững kiến trúc hệ thống và nguyên lý thiết kế cơ sở dữ liệu phân tán.
- [ ] Xây dựng giải pháp đảm bảo tính sẵn sàng cao (High Availability).
- [ ] Triển khai kiểm thử hồi quy và đo lường hiệu năng.

### 2. Kế hoạch học tập và phân bổ thời lượng
| Tuần | Chủ đề đào tạo | Hình thức | Chuẩn đầu ra |
| :--- | :--- | :--- | :--- |
| Tuần 1-3 | Tổng quan kiến trúc hướng dịch vụ | Lý thuyết & Demo | CLO-1 |
| Tuần 4-7 | Thiết kế CSDL & Tối ưu hóa truy vấn | Thực hành Lab | CLO-2 |
| Tuần 8-12 | Báo cáo tiến độ đồ án & Phản biện | Thuyết trình nhóm | CLO-3 |
`;

export const EDITOR_TEMPLATE_IDS = [
  'council-decision',
  'registration-notice',
  'scholarship-notice',
] as const;

export type EditorTemplateId = (typeof EDITOR_TEMPLATE_IDS)[number];

/** Template library bodies, keyed by the stable ids exported above. */
export const EDITOR_TEMPLATE_HTML: Record<EditorTemplateId, string> = {
  'council-decision': `
<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b;">
  <div style="text-align: center; border-bottom: 2px solid #0d509d; padding-bottom: 12px; margin-bottom: 20px;">
    <h4 style="margin: 0; text-transform: uppercase; color: #64748b; font-size: 13px;">TRƯỜNG ĐẠI HỌC CÔNG NGHỆ KỸ THUẬT TP.HCM</h4>
    <h2 style="margin: 8px 0 0 0; color: #0d509d; font-size: 20px; font-weight: bold;">QUYẾT ĐỊNH THÀNH LẬP HỘI ĐỒNG CHẤM BẢO VỆ KHÓA LUẬN TỐT NGHIỆP</h2>
    <p style="margin: 4px 0 0 0; color: #64748b; font-size: 13px;">Căn cứ Quy chế đào tạo đại học và Đề án tổ chức đánh giá tốt nghiệp</p>
  </div>
  <p><strong>HIỆU TRƯỞNG TRƯỜNG ĐẠI HỌC CÔNG NGHỆ KỸ THUẬT TP.HCM QUYẾT ĐỊNH:</strong></p>
  <p><strong>Điều 1.</strong> Thành lập Hội đồng chấm bảo vệ Khóa luận tốt nghiệp chuyên ngành Kỹ thuật Phần mềm gồm các thành viên:</p>
  <ul>
    <li><strong>Ghế 1 (Chủ tịch):</strong> [Họ tên - học hàm, chức danh giảng dạy]</li>
    <li><strong>Ghế 2 (Thư ký):</strong> [Họ tên - học hàm, chức danh giảng dạy]</li>
    <li><strong>Ghế 3 (Ủy viên):</strong> [Họ tên - học hàm, chức danh giảng dạy]</li>
    <li><strong>Ghế 4 (Ủy viên):</strong> [Họ tên - học hàm, chức danh giảng dạy]</li>
  </ul>
  <p><strong>Điều 2.</strong> Hội đồng có nhiệm vụ tổ chức chấm điểm bảo vệ công tâm, minh bạch theo Quy định R1–R9.</p>
  <table style="width: 100%; margin-top: 24px; border: none;">
    <tr>
      <td style="width: 50%; vertical-align: top; border: none;">
        <p style="font-size: 11px; margin: 0; line-height: 1.5;"><strong><em>Nơi nhận:</em></strong><br/>- Như Điều 1;<br/>- Ban Giám hiệu (để b/c);<br/>- Phòng ĐT, VP Khoa CNTT;<br/>- Lưu: VT.</p>
      </td>
      <td style="width: 50%; text-align: right; vertical-align: top; border: none;">
        <p style="font-weight: bold; margin: 0; text-transform: uppercase;">HIỆU TRƯỞNG</p>
        <div style="height: 48px;"></div>
        <p style="font-weight: bold; margin: 0; color: #0d509d;">[Họ tên &amp; học hàm người ký]</p>
      </td>
    </tr>
  </table>
</div>
`,
  'registration-notice': EDITOR_SEED_HTML.vi,
  'scholarship-notice': `
<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b;">
  <div style="text-align: center; border-bottom: 2px solid #16a34a; padding-bottom: 12px; margin-bottom: 20px;">
    <h4 style="margin: 0; text-transform: uppercase; color: #64748b; font-size: 13px;">TRƯỜNG ĐẠI HỌC CÔNG NGHỆ KỸ THUẬT TP.HCM</h4>
    <h2 style="margin: 8px 0 0 0; color: #15803d; font-size: 20px; font-weight: bold;">THÔNG BÁO XÉT CẤP HỌC BỔNG KHUYẾN KHÍCH HỌC TẬP</h2>
    <p style="margin: 4px 0 0 0; color: #64748b; font-size: 13px;">Học kỳ [ ... ] - Năm học [ ... ]</p>
  </div>
  <p>Phòng Đào tạo thông báo điều kiện và định mức xét học bổng khuyến khích học tập kỳ này:</p>
  <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
    <thead>
      <tr style="background-color: #f0fdf4;">
        <th style="border: 1px solid #bbf7d0; padding: 10px;">Xếp loại</th>
        <th style="border: 1px solid #bbf7d0; padding: 10px;">Điểm GPA (thang 4)</th>
        <th style="border: 1px solid #bbf7d0; padding: 10px;">Điểm rèn luyện</th>
        <th style="border: 1px solid #bbf7d0; padding: 10px;">Định mức</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="border: 1px solid #bbf7d0; padding: 10px;">Xuất sắc</td>
        <td style="border: 1px solid #bbf7d0; padding: 10px;">≥ 3.60</td>
        <td style="border: 1px solid #bbf7d0; padding: 10px;">≥ 90</td>
        <td style="border: 1px solid #bbf7d0; padding: 10px;">120% Học phí</td>
      </tr>
      <tr>
        <td style="border: 1px solid #bbf7d0; padding: 10px;">Giỏi</td>
        <td style="border: 1px solid #bbf7d0; padding: 10px;">3.20 - 3.59</td>
        <td style="border: 1px solid #bbf7d0; padding: 10px;">≥ 80</td>
        <td style="border: 1px solid #bbf7d0; padding: 10px;">100% Học phí</td>
      </tr>
    </tbody>
  </table>
</div>
`,
};

/**
 * English bodies for the template library, mirroring `EDITOR_TEMPLATE_HTML`.
 * `registration-notice` keeps the same outline as the Vietnamese seed document
 * (header, audience, milestones table, closing notice) so both locales insert a
 * structurally identical draft.
 */
export const EDITOR_TEMPLATE_HTML_EN: Record<EditorTemplateId, string> = {
  'council-decision': `
<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b;">
  <div style="text-align: center; border-bottom: 2px solid #0d509d; padding-bottom: 12px; margin-bottom: 20px;">
    <h4 style="margin: 0; text-transform: uppercase; color: #64748b; font-size: 13px;">HCMC UNIVERSITY OF TECHNOLOGY AND ENGINEERING</h4>
    <h2 style="margin: 8px 0 0 0; color: #0d509d; font-size: 20px; font-weight: bold;">DECISION ON ESTABLISHING THE GRADUATION THESIS DEFENCE COUNCIL</h2>
    <p style="margin: 4px 0 0 0; color: #64748b; font-size: 13px;">Pursuant to the University Training Regulations and the graduation assessment programme</p>
  </div>
  <p><strong>THE RECTOR OF HCMC UNIVERSITY OF TECHNOLOGY AND ENGINEERING DECIDES:</strong></p>
  <p><strong>Article 1.</strong> Establish the Graduation Thesis Defence Council for the Software Engineering major, consisting of the following members:</p>
  <ul>
    <li><strong>Seat 1 (Chair):</strong> [Full name - academic title, teaching position]</li>
    <li><strong>Seat 2 (Secretary):</strong> [Full name - academic title, teaching position]</li>
    <li><strong>Seat 3 (Member):</strong> [Full name - academic title, teaching position]</li>
    <li><strong>Seat 4 (Member):</strong> [Full name - academic title, teaching position]</li>
  </ul>
  <p><strong>Article 2.</strong> The Council is responsible for organising a fair and transparent defence assessment in accordance with Regulations R1–R9.</p>
  <table style="width: 100%; margin-top: 24px; border: none;">
    <tr>
      <td style="width: 50%; vertical-align: top; border: none;">
        <p style="font-size: 11px; margin: 0; line-height: 1.5;"><strong><em>Recipients:</em></strong><br/>- As in Article 1;<br/>- Board of Rectors (for reporting);<br/>- Office of Academic Affairs, Faculty of IT Office;<br/>- Filed: Secretariat.</p>
      </td>
      <td style="width: 50%; text-align: right; vertical-align: top; border: none;">
        <p style="font-weight: bold; margin: 0; text-transform: uppercase;">RECTOR</p>
        <div style="height: 48px;"></div>
        <p style="font-weight: bold; margin: 0; color: #0d509d;">[Signatory name &amp; academic title]</p>
      </td>
    </tr>
  </table>
</div>
`,
  'registration-notice': `
<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b;">
  <div style="text-align: center; border-bottom: 2px solid #0284c7; padding-bottom: 12px; margin-bottom: 20px;">
    <h4 style="margin: 0; text-transform: uppercase; color: #64748b; font-size: 13px; letter-spacing: 1px;">HCMC UNIVERSITY OF TECHNOLOGY AND ENGINEERING</h4>
    <h2 style="margin: 8px 0 0 0; color: #0f172a; font-size: 22px; font-weight: 700;">ACADEMIC NOTICE & ACADEMIC AFFAIRS GUIDELINES</h2>
    <p style="margin: 4px 0 0 0; color: #64748b; font-size: 13px;">[Term ... - Academic Year ...] | [Issuing office]</p>
  </div>

  <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 14px 18px; border-radius: 6px; margin-bottom: 20px;">
    <strong style="color: #1d4ed8; font-size: 14px;">Attention:</strong> All Faculty Members, Academic Affairs Staff, and full-time students.
  </div>

  <h3 style="color: #0369a1; font-size: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">1. Academic Plan & Course Credit Registration</h3>
  <p>The University announces the academic plan and the opening time of the course-credit registration portal for the new term:</p>

  <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
    <thead>
      <tr style="background-color: #f1f5f9; text-align: left;">
        <th style="border: 1px solid #cbd5e1; padding: 10px; font-weight: 600;">Batch</th>
        <th style="border: 1px solid #cbd5e1; padding: 10px; font-weight: 600;">Start Time</th>
        <th style="border: 1px solid #cbd5e1; padding: 10px; font-weight: 600;">End Time</th>
        <th style="border: 1px solid #cbd5e1; padding: 10px; font-weight: 600;">Target Cohort</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">Phase 1</td>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">[HH:mm - Mon DD, YYYY]</td>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">[HH:mm - Mon DD, YYYY]</td>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">[Target cohort]</td>
      </tr>
      <tr>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">Phase 2</td>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">[HH:mm - Mon DD, YYYY]</td>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">[HH:mm - Mon DD, YYYY]</td>
        <td style="border: 1px solid #cbd5e1; padding: 10px;">[Target cohort]</td>
      </tr>
    </tbody>
  </table>

  <div style="background-color: #fefce8; border-left: 4px solid #eab308; padding: 14px 18px; border-radius: 6px; margin-bottom: 20px;">
    <strong style="color: #a16207;">Important note:</strong> Students must check the prerequisite requirements and their class schedule before confirming.
  </div>
</div>
`,
  'scholarship-notice': `
<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b;">
  <div style="text-align: center; border-bottom: 2px solid #16a34a; padding-bottom: 12px; margin-bottom: 20px;">
    <h4 style="margin: 0; text-transform: uppercase; color: #64748b; font-size: 13px;">HCMC UNIVERSITY OF TECHNOLOGY AND ENGINEERING</h4>
    <h2 style="margin: 8px 0 0 0; color: #15803d; font-size: 20px; font-weight: bold;">MERIT SCHOLARSHIP AWARD ANNOUNCEMENT</h2>
    <p style="margin: 4px 0 0 0; color: #64748b; font-size: 13px;">Term [ ... ] - Academic Year [ ... ]</p>
  </div>
  <p>The Office of Academic Affairs announces this term's eligibility criteria and award levels for merit scholarships:</p>
  <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
    <thead>
      <tr style="background-color: #f0fdf4;">
        <th style="border: 1px solid #bbf7d0; padding: 10px;">Classification</th>
        <th style="border: 1px solid #bbf7d0; padding: 10px;">GPA (4-point scale)</th>
        <th style="border: 1px solid #bbf7d0; padding: 10px;">Conduct score</th>
        <th style="border: 1px solid #bbf7d0; padding: 10px;">Award level</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="border: 1px solid #bbf7d0; padding: 10px;">Excellent</td>
        <td style="border: 1px solid #bbf7d0; padding: 10px;">≥ 3.60</td>
        <td style="border: 1px solid #bbf7d0; padding: 10px;">≥ 90</td>
        <td style="border: 1px solid #bbf7d0; padding: 10px;">120% of tuition</td>
      </tr>
      <tr>
        <td style="border: 1px solid #bbf7d0; padding: 10px;">Very Good</td>
        <td style="border: 1px solid #bbf7d0; padding: 10px;">3.20 - 3.59</td>
        <td style="border: 1px solid #bbf7d0; padding: 10px;">≥ 80</td>
        <td style="border: 1px solid #bbf7d0; padding: 10px;">100% of tuition</td>
      </tr>
    </tbody>
  </table>
</div>
`,
};

/** Locale selector for the template-library HTML bodies. */
export function getEditorTemplateHtml(id: EditorTemplateId, isVi: boolean): string {
  return isVi ? EDITOR_TEMPLATE_HTML[id] : EDITOR_TEMPLATE_HTML_EN[id];
}
