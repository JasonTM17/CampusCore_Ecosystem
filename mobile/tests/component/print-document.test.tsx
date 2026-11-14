import { describe, expect, it } from '@jest/globals';

import { dispatchPrintHtml, conductPrintHtml } from '../../src/screens/content/print-document';
import type { ConductModel, ConductTerm } from '../../src/screens/content/records-model';

const dispatchData = {
  title: 'Thông báo họp khoa',
  ministryName: 'BỘ GIÁO DỤC VÀ ĐÀO TẠO',
  universityName: 'TRƯỜNG ĐẠI HỌC CÔNG NGHỆ KỸ THUẬT TP.HCM',
  publisherName: 'PHÒNG ĐÀO TẠO',
  nationalMotto1: 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM',
  nationalMotto2: 'Độc lập - Tự do - Hạnh phúc',
  dateLine: 'TP. Hồ Chí Minh, ngày 14 tháng 11 năm 2026',
  docRef: 'Số: 42/TB-ĐT',
  noticeHeader: 'THÔNG BÁO',
  subjectHeading: 'V/v họp khoa định kỳ',
  salutationLabel: 'Kính gửi',
  salutationTarget: 'Quý thầy cô',
  metaLine: 'Toàn trường · HK1 2026 · 14/11/2026',
  body: null as string | null,
  attachmentsHeading: 'Tệp đính kèm',
  attachments: [] as { name: string; url: string; type: 'pdf' | 'docx' | 'xlsx' | 'zip' | 'other' }[],
  issuedByLabel: 'Đơn vị ban hành',
  signOffText: 'Thông báo điện tử — 14/11/2026 09:00',
};

describe('dispatchPrintHtml', () => {
  it('renders the official dispatch fields', () => {
    const html = dispatchPrintHtml({ ...dispatchData, body: 'Nội dung <b>thi</b>' });
    expect(html).toContain('THÔNG BÁO');
    expect(html).toContain('Số: 42/TB-ĐT');
    expect(html).toContain('PHÒNG ĐÀO TẠO');
    expect(html).toContain('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM');
    expect(html).toContain('V/v họp khoa định kỳ');
  });

  it('escapes plain-text bodies and strips active markup', () => {
    const html = dispatchPrintHtml({
      ...dispatchData,
      body: '<p>Nội dung</p><script>alert(1)</script><a href="javascript:evil()">x</a>',
    });
    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('<p>Nội dung</p>');
  });

  it('lists attachments when present', () => {
    const html = dispatchPrintHtml({
      ...dispatchData,
      body: 'x',
      attachments: [{ name: 'ke-hoach.pdf', url: '/f/ke-hoach.pdf', type: 'pdf' }],
    });
    expect(html).toContain('ke-hoach.pdf');
    expect(html).toContain('Tệp đính kèm');
  });
});

const term: ConductTerm = {
  id: 't1',
  semesterId: 's1',
  semesterName: 'Học kỳ 1',
  totalScore: 82,
  classification: 'TOT',
  classificationVi: 'Tốt',
  status: 'APPROVED',
  evaluatorName: 'Nguyen Van A',
  criteria: [{ code: 'CRITERIA_1', nameVi: 'Chuyên cần', nameEn: 'Attendance', description: null, score: 18, maxScore: 20 }],
  activities: [{ id: 'a1', title: 'Hiến máu', category: 'Tình nguyện', organizer: 'Đoàn trường', activityDate: '2026-10-01', points: 5 }],
};

const model: ConductModel = {
  studentCode: '21110001',
  fullName: 'Tran Thi B',
  cumulativeAverage: 80.5,
  cumulativeClassificationVi: 'Tốt',
  terms: [term],
};

const numberFmt = (v: number | null | undefined) => (v == null ? '—' : String(v));

describe('conductPrintHtml', () => {
  const html = conductPrintHtml({
    title: 'Điểm rèn luyện',
    universityName: 'TRƯỜNG ĐẠI HỌC CÔNG NGHỆ KỸ THUẬT TP.HCM',
    generatedLabel: 'Xuất bản',
    generatedAt: '14/11/2026 09:00',
    studentName: model.fullName,
    studentCode: model.studentCode,
    studentLabel: 'Sinh viên',
    codeLabel: 'MSSV',
    term,
    semesterLabel: 'Học kỳ 1',
    totalLabel: 'Tổng điểm',
    rankLabel: 'Tốt',
    statusLabel: 'Trạng thái: Đã phê duyệt',
    evaluatorLabel: 'Người duyệt',
    criteriaHeading: '5 tiêu chí rèn luyện',
    scoreUnit: 'điểm',
    reachedLabel: 'Đạt',
    activitiesHeading: 'Hoạt động đã duyệt',
    pointsLabel: 'điểm',
    cumulativeLabel: 'Điểm TB toàn khóa',
    cumulativeScore: '80.5',
    cumulativeRankLabel: 'Xếp loại: Tốt',
    model,
    criterionName: (code, nameVi) => nameVi ?? code,
    formatNumber: numberFmt,
  });

  it('prints student identity, term criteria and history', () => {
    expect(html).toContain('Tran Thi B');
    expect(html).toContain('21110001');
    expect(html).toContain('Chuyên cần');
    expect(html).toContain('18 / 20');
    expect(html).toContain('Hiến máu');
    expect(html).toContain('80.5');
    expect(html).toContain('Học kỳ 1');
  });
});
