/** Admin operations copy (assistant knowledge, analytics, events header, audit). */
export interface AdminOpsCopy {
  assistantKnowledge: {
    errorSecondReview: string; errorForbidden: string; errorGeneric: string;
    staleVersion: string;
    unknownState: string; otherDomain: string;
    ui: Record<string, string>;
  };
  analytics: {
    lecturerRankFallback: string; noDistributionTitle: string;
    noDistributionDescription: string;
    facultyLoading: string; noFacultyData: string;
    trendsLoading: string; noTrendsData: string; currentTerm: string;
    ranksLoading: string; noRanksData: string;
    gradesLoading: string; noGradesData: string;
  };
  events: { header: { title: string; description: string } };
  audit: { searchPlaceholder: string };
}

export const adminOpsEn: AdminOpsCopy = {
  assistantKnowledge: {
    errorSecondReview:
      'A different administrator must publish this revision. Reload to see the latest state.',
    errorForbidden: 'You are not allowed to perform this action.',
    errorGeneric: 'The action could not be completed. Please try again.',
    staleVersion:
      'This guidance changed after you opened it. Your edits are still here; reload to compare before saving.',
    unknownState: 'Unknown', otherDomain: 'Other',
    ui: {
      publicCampusuteGuidance: 'Public CampusUTE guidance',
      domain: 'Domain',
      filterDomain: 'Filter domain',
      status: 'Status',
      filterStatus: 'Filter status',
      search: 'Search',
      slugOrTitle: 'Slug or title…',
      searchDocuments: 'Search documents',
      reload: 'Reload',
      guidance: 'Guidance',
      domain2: 'Domain',
      status2: 'Status',
      revision: 'Revision',
      actions: 'Actions',
      view: 'View',
      edit: 'Edit',
      sendForReview: 'Send for review',
      release: 'Release',
      archive: 'Archive',
      guidanceCode: 'Guidance code',
      domain22: 'Domain',
      language: 'Language',
      both: 'Both',
      title: 'Title',
      reference: 'Reference',
      guidanceContent: 'Guidance content',
      cancel: 'Cancel',
      saving: 'Saving...',
      saveDraft: 'Save draft',
      guidanceCodeTitleContent: 'Guidance code, title, content, and reference are required.',
      draftSaved: 'Draft saved.',
      submittedForReview: 'Submitted for review.',
      publishedTheAssistantHas: 'Published; the assistant has not updated yet. Check sync status.',
      guidancePublishedForThe: 'Guidance published for the assistant.',
      archivedInAdministrationThe: 'Archived in administration; the assistant has not updated yet. Check sync status.',
      guidanceArchivedItsChange: 'Guidance archived. Its change history remains available.',
      campusuteKnowledge: 'CampusUTE knowledge',
      accessRestricted: 'Access restricted',
      onlyAdministratorsCanManage: 'Only administrators can manage published guidance.',
      returnToOverview: 'Return to overview',
      addGuidance: 'Add guidance',
      retry: 'Retry',
      totalGuidance: 'Total guidance',
      published: 'Published',
      pendingReview: 'Pending review',
      reviewedGuidance: 'Reviewed guidance',
      loadingGuidance: 'Loading guidance...',
      noMatchingGuidance: 'No matching guidance.',
      archiveGuidance: 'Archive guidance?',
      archive2: 'Archive',
      viewGuidance: 'View guidance',
      loadingDocument: 'Loading…',
      close: 'Close',
      version: 'Version',
      priority: 'Priority',
      publishedAt: 'Published at'
    },
  },
  analytics: {
    lecturerRankFallback: 'Lecturer', noDistributionTitle: 'Distribution statistics unavailable',
    noDistributionDescription: 'Live campus distribution and grade statistics are currently unavailable from the distribution service.',
    facultyLoading: 'Loading faculty statistics...', noFacultyData: 'No faculty data available',
    trendsLoading: 'Loading semester trends...', noTrendsData: 'No semester trends recorded',
    currentTerm: 'Current term',
    ranksLoading: 'Loading faculty ranks...', noRanksData: 'No faculty rank data',
    gradesLoading: 'Loading grade distribution...', noGradesData: 'No grade records',
  },
  events: {
    header: {
      title: 'Events & union activities',
      description: 'Lifecycle, roster and manual attendance for staff-managed events.',
    },
  },
  audit: { searchPlaceholder: 'e.g. password reset or an email address' },
};

export const adminOpsVi: AdminOpsCopy = {
  assistantKnowledge: {
    errorSecondReview:
      'Bản nháp cần một quản trị viên khác duyệt xuất bản. Hãy tải lại để xem trạng thái mới.',
    errorForbidden: 'Bạn không có quyền thực hiện thao tác này.',
    errorGeneric: 'Không thể hoàn thành thao tác. Vui lòng thử lại.',
    staleVersion:
      'Nội dung đã thay đổi sau khi bạn mở. Các chỉnh sửa vẫn được giữ; hãy tải lại để so sánh trước khi lưu.',
    unknownState: 'Chưa xác định', otherDomain: 'Khác',
    ui: {
      publicCampusuteGuidance: 'Phạm vi nội dung CampusUTE công khai',
      domain: 'Lĩnh vực',
      filterDomain: 'Lọc lĩnh vực',
      status: 'Trạng thái',
      filterStatus: 'Lọc trạng thái',
      search: 'Tìm kiếm',
      slugOrTitle: 'Slug hoặc tiêu đề…',
      searchDocuments: 'Tìm kiếm tài liệu',
      reload: 'Tải lại',
      guidance: 'Nội dung',
      domain2: 'Lĩnh vực',
      status2: 'Trạng thái',
      revision: 'Lần cập nhật',
      actions: 'Thao tác',
      view: 'Xem',
      edit: 'Sửa',
      sendForReview: 'Gửi duyệt',
      release: 'Xuất bản',
      archive: 'Lưu trữ',
      guidanceCode: 'Mã nội dung',
      domain22: 'Lĩnh vực',
      language: 'Ngôn ngữ',
      both: 'Cả hai',
      title: 'Tiêu đề',
      reference: 'Nguồn tham chiếu',
      guidanceContent: 'Nội dung quy chế / tri thức',
      cancel: 'Hủy',
      saving: 'Đang lưu...',
      saveDraft: 'Lưu bản nháp',
      guidanceCodeTitleContent: 'Vui lòng điền mã nội dung, tiêu đề, nội dung và nguồn tham chiếu.',
      draftSaved: 'Đã lưu bản nháp.',
      submittedForReview: 'Đã gửi xét duyệt.',
      publishedTheAssistantHas: 'Đã xuất bản; trợ lý chưa cập nhật. Hãy kiểm tra trạng thái đồng bộ.',
      guidancePublishedForThe: 'Đã xuất bản nội dung cho trợ lý.',
      archivedInAdministrationThe: 'Đã lưu trữ trong kho quản trị; trợ lý chưa cập nhật. Hãy kiểm tra trạng thái đồng bộ.',
      guidanceArchivedItsChange: 'Đã lưu trữ nội dung. Lịch sử thay đổi vẫn được giữ.',
      campusuteKnowledge: 'Kho kiến thức CampusUTE',
      accessRestricted: 'Không có quyền truy cập',
      onlyAdministratorsCanManage: 'Chỉ quản trị viên có thể quản lý nội dung đã công bố.',
      returnToOverview: 'Về trang tổng quan',
      addGuidance: 'Tạo nội dung',
      retry: 'Thử lại',
      totalGuidance: 'Tổng nội dung',
      published: 'Đã xuất bản',
      pendingReview: 'Chờ duyệt',
      reviewedGuidance: 'Nội dung đã kiểm duyệt',
      loadingGuidance: 'Đang tải nội dung...',
      noMatchingGuidance: 'Chưa có nội dung phù hợp.',
      archiveGuidance: 'Lưu trữ nội dung?',
      archive2: 'Lưu trữ',
      viewGuidance: 'Xem nội dung',
      loadingDocument: 'Đang tải…',
      close: 'Đóng',
      version: 'Phiên bản',
      priority: 'Ưu tiên',
      publishedAt: 'Xuất bản lúc'
    },
  },
  analytics: {
    lecturerRankFallback: 'Giảng viên', noDistributionTitle: 'Không có dữ liệu thống kê phân bố',
    noDistributionDescription: 'Dữ liệu thống kê phân bố sinh viên, giảng viên và phổ điểm từ hệ thống hiện chưa sẵn sàng.',
    facultyLoading: 'Đang nạp dữ liệu thống kê khoa...', noFacultyData: 'Chưa có dữ liệu khoa',
    trendsLoading: 'Đang nạp xu hướng học kỳ...', noTrendsData: 'Chưa có dữ liệu học kỳ',
    currentTerm: 'Học kỳ hiện tại',
    ranksLoading: 'Đang nạp phân bố giảng viên...', noRanksData: 'Chưa có dữ liệu học hàm',
    gradesLoading: 'Đang nạp phân bố điểm...', noGradesData: 'Chưa có dữ liệu điểm học phần',
  },
  events: {
    header: {
      title: 'Sự kiện & hoạt động Đoàn–Hội',
      description: 'Vòng đời, danh sách đăng ký và điểm danh thủ công cho sự kiện Đoàn–Hội.',
    },
  },
  audit: { searchPlaceholder: 'Ví dụ: đặt lại mật khẩu hoặc địa chỉ email' },
};
