export const staffMessages = {
  vi: {
    title: 'Bàn làm việc',
    failed: 'Không tải được quyền bàn làm việc.',
    failedHint: 'Kiểm tra kết nối rồi thử lại.',
    empty: 'Bạn chưa được cấp bàn làm việc nào.',
    emptyHint: 'Khi nhà trường cấp quyền nghiệp vụ (tuyển sinh, thư viện, nghề nghiệp, sự kiện), bàn tương ứng sẽ xuất hiện tại đây.',
  },
  en: {
    title: 'Staff desks',
    failed: 'Could not load desk access.',
    failedHint: 'Check the connection and try again.',
    empty: 'You have no staff desks yet.',
    emptyHint: 'When the university grants you a staff scope (admissions, library, careers, events), its desk will appear here.',
  },
} as const;
