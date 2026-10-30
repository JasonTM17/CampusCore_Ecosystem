/**
 * Content-lane copy (hub, news, public docs, announcement lifecycle UI).
 *
 * P06 hub/news/docs surfaces and the announcement review workflow strings
 * live here rather than in messages.ts to keep that file reviewable; the `vi`
 * object is typed against the widened `en` shape so a missing or extra key is
 * a compile error (publication-policy §6).
 */

type Widen<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? readonly Widen<U>[]
    : T extends object
      ? { readonly [K in keyof T]: Widen<T[K]> }
      : T;

export const contentEn = {
  hub: {
    title: 'Campus hub',
    subtitle: 'One doorway into the CampusUTE ecosystem — sign in for the entries your role unlocks.',
    publicSection: 'Open to everyone',
    workspaceSection: 'Your workspace',
    signInCta: 'Sign in to see your workspace',
    open: 'Open',
    plannedStatus: 'Planned',
    entries: {
      news: {
        title: 'Campus news',
        description: 'Published announcements and press from the university.',
      },
      docs: {
        title: 'Public documents',
        description: 'Regulations, guides, and reference material — published revisions only.',
      },
      events: {
        title: 'Campus events',
        description: 'Event calendar, registration, and attendance tracking.',
      },
      library: {
        title: 'Library',
        description: 'Catalogue search, borrowing, and reading-room services.',
      },
      admissions: {
        title: 'Admissions',
        description: 'Programmes, application rounds, and enrolment status.',
      },
      learning: {
        title: 'Online learning',
        description: 'Courses, assignments, and learning materials.',
      },
      careers: {
        title: 'Careers & internships',
        description: 'Job postings, internship partners, and applications.',
      },
      dashboard: {
        title: 'Student portal',
        description: 'Timetable, grades, tuition, and personal announcements.',
      },
      lecturer: {
        title: 'Lecturer workspace',
        description: 'Sections, attendance, marks, and course announcements.',
      },
      admin: {
        title: 'Administration',
        description: 'Catalog, accounts, announcements, and governance queues.',
      },
      login: {
        title: 'Sign in',
        description: 'Continue to the single sign-on portal.',
      },
    },
  },
  news: {
    title: 'Campus news',
    subtitle: 'Published announcements from the university.',
    searchPlaceholder: 'Search news…',
    empty: 'No published stories yet.',
    readMore: 'Read the story',
    backToList: 'Back to all news',
    publishedOn: 'Published {date}',
    notFoundTitle: 'Story unavailable',
    notFoundBody: 'This story is not published or no longer exists.',
    loadErrorTitle: 'News feed unavailable',
    loadError: 'Could not load the news feed. Please retry.',
    priority: {
      LOW: 'Low',
      NORMAL: 'Normal',
      HIGH: 'Important',
      URGENT: 'Urgent',
    },
  },
  docs: {
    title: 'Public documents',
    subtitle: 'Published regulations, guides, and reference material.',
    searchPlaceholder: 'Search documents (Vietnamese or English)…',
    searchAction: 'Search',
    empty: 'No published documents match.',
    open: 'Open document',
    backToList: 'Back to all documents',
    publishedOn: 'Published {date}',
    revisionLabel: 'Revision {revision}',
    permalinkLabel: 'Permalink to this revision',
    supersededNote: 'You are viewing an older revision. The current published revision is {current}.',
    notFoundTitle: 'Document unavailable',
    notFoundBody: 'This document is not published or no longer exists.',
    loadErrorTitle: 'Documents unavailable',
    loadError: 'Could not load documents. Please retry.',
    bodyLabel: 'Document content',
    allCategories: 'All categories',
  },
  lifecycle: {
    status: {
      DRAFT: 'Draft',
      IN_REVIEW: 'In review',
      PUBLISHED: 'Published',
      ARCHIVED: 'Archived',
    },
    filter: {
      ACTIVE: 'Active',
      ALL: 'All',
      DRAFT: 'Drafts',
      IN_REVIEW: 'In review',
      PUBLISHED: 'Published',
      ARCHIVED: 'Archived',
    },
    actions: {
      submit: 'Submit for review',
      approve: 'Approve & publish',
      returnForRework: 'Return for rework',
    },
    confirmSubmit: 'Send this draft to the review queue?',
    returnReasonTitle: 'Return announcement for rework',
    returnReasonLabel: 'Reason for returning (required)',
    returnReasonPlaceholder: 'Tell the author what to fix…',
    returnReasonRequired: 'A return reason is required.',
    authorLabel: 'Author',
    reviewerLabel: 'Reviewer',
    reviewNoteLabel: 'Reviewer note',
    ownPostHint: 'You authored this — another reviewer must publish it.',
    submitted: 'Draft submitted for review.',
    approved: 'Announcement published.',
    returned: 'Announcement returned to draft.',
  },
};

export const contentVi: Widen<typeof contentEn> = {
  hub: {
    title: 'Trung tâm trường học',
    subtitle: 'Một điểm vào hệ sinh thái CampusUTE — đăng nhập để mở các mục theo vai trò của bạn.',
    publicSection: 'Mở cho mọi người',
    workspaceSection: 'Không gian làm việc của bạn',
    signInCta: 'Đăng nhập để xem không gian làm việc',
    open: 'Mở',
    plannedStatus: 'Sắp ra mắt',
    entries: {
      news: {
        title: 'Tin tức trường',
        description: 'Thông báo và bài viết đã xuất bản của nhà trường.',
      },
      docs: {
        title: 'Tài liệu công khai',
        description: 'Quy định, hướng dẫn và tài liệu tham khảo — chỉ phiên bản đã xuất bản.',
      },
      events: {
        title: 'Sự kiện trường',
        description: 'Lịch sự kiện, đăng ký tham gia và điểm danh.',
      },
      library: {
        title: 'Thư viện',
        description: 'Tra cứu tài liệu, mượn trả và dịch vụ phòng đọc.',
      },
      admissions: {
        title: 'Tuyển sinh',
        description: 'Ngành đào tạo, đợt xét tuyển và trạng thái nhập học.',
      },
      learning: {
        title: 'Học tập trực tuyến',
        description: 'Học phần, bài tập và tài liệu học tập.',
      },
      careers: {
        title: 'Việc làm & thực tập',
        description: 'Tin tuyển dụng, đối tác thực tập và hồ sơ ứng tuyển.',
      },
      dashboard: {
        title: 'Cổng sinh viên',
        description: 'Thời khóa biểu, điểm, học phí và thông báo cá nhân.',
      },
      lecturer: {
        title: 'Không gian giảng viên',
        description: 'Lớp học phần, điểm danh, điểm số và thông báo học phần.',
      },
      admin: {
        title: 'Quản trị',
        description: 'Danh mục, tài khoản, thông báo và hàng chờ kiểm duyệt.',
      },
      login: {
        title: 'Đăng nhập',
        description: 'Tiếp tục tới cổng đăng nhập một lần.',
      },
    },
  },
  news: {
    title: 'Tin tức trường',
    subtitle: 'Thông báo đã xuất bản của nhà trường.',
    searchPlaceholder: 'Tìm tin tức…',
    empty: 'Chưa có bài viết nào được xuất bản.',
    readMore: 'Đọc bài viết',
    backToList: 'Quay lại danh sách tin',
    publishedOn: 'Xuất bản {date}',
    notFoundTitle: 'Bài viết không khả dụng',
    notFoundBody: 'Bài viết này chưa xuất bản hoặc không còn tồn tại.',
    loadErrorTitle: 'Bảng tin chưa khả dụng',
    loadError: 'Không tải được bảng tin. Vui lòng thử lại.',
    priority: {
      LOW: 'Thấp',
      NORMAL: 'Bình thường',
      HIGH: 'Quan trọng',
      URGENT: 'Khẩn',
    },
  },
  docs: {
    title: 'Tài liệu công khai',
    subtitle: 'Quy định, hướng dẫn và tài liệu tham khảo đã xuất bản.',
    searchPlaceholder: 'Tìm tài liệu (tiếng Việt hoặc tiếng Anh)…',
    searchAction: 'Tìm kiếm',
    empty: 'Không có tài liệu nào phù hợp.',
    open: 'Mở tài liệu',
    backToList: 'Quay lại danh sách tài liệu',
    publishedOn: 'Xuất bản {date}',
    revisionLabel: 'Phiên bản {revision}',
    permalinkLabel: 'Liên kết tới phiên bản này',
    supersededNote: 'Bạn đang xem phiên bản cũ. Phiên bản đã xuất bản hiện tại là {current}.',
    notFoundTitle: 'Tài liệu không khả dụng',
    notFoundBody: 'Tài liệu này chưa xuất bản hoặc không còn tồn tại.',
    loadErrorTitle: 'Tài liệu chưa khả dụng',
    loadError: 'Không tải được tài liệu. Vui lòng thử lại.',
    bodyLabel: 'Nội dung tài liệu',
    allCategories: 'Tất cả chuyên mục',
  },
  lifecycle: {
    status: {
      DRAFT: 'Nháp',
      IN_REVIEW: 'Chờ duyệt',
      PUBLISHED: 'Đã xuất bản',
      ARCHIVED: 'Đã lưu trữ',
    },
    filter: {
      ACTIVE: 'Đang hiển thị',
      ALL: 'Tất cả',
      DRAFT: 'Nháp',
      IN_REVIEW: 'Chờ duyệt',
      PUBLISHED: 'Đã xuất bản',
      ARCHIVED: 'Đã lưu trữ',
    },
    actions: {
      submit: 'Gửi duyệt',
      approve: 'Duyệt & xuất bản',
      returnForRework: 'Trả về sửa',
    },
    confirmSubmit: 'Gửi bản nháp này vào hàng chờ duyệt?',
    returnReasonTitle: 'Trả thông báo về nháp',
    returnReasonLabel: 'Lý do trả về (bắt buộc)',
    returnReasonPlaceholder: 'Ghi chú cho tác giả biết cần sửa gì…',
    returnReasonRequired: 'Bắt buộc nhập lý do trả về.',
    authorLabel: 'Tác giả',
    reviewerLabel: 'Người duyệt',
    reviewNoteLabel: 'Ghi chú của người duyệt',
    ownPostHint: 'Bạn là tác giả — cần người duyệt khác để xuất bản.',
    submitted: 'Đã gửi bản nháp chờ duyệt.',
    approved: 'Đã xuất bản thông báo.',
    returned: 'Đã trả thông báo về nháp.',
  },
};
