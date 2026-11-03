/**
 * Announcement workspace copy.
 *
 * Owns every user-facing string for the announcement composer, reader, feed
 * card and lecturer notice workspace. The article-category labels are NOT
 * duplicated here: they keep resolving from `INSTITUTIONAL_ARTICLE_CATEGORIES`
 * through `articleCategoryLabel` (single source, S7).
 *
 * Consumed by a direct import from the components and from
 * `lib/announcement-presentation.ts` (which receives an explicit locale and
 * cannot use hooks). The root dictionary mount is the integrator's step.
 */

type Widen<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? readonly Widen<U>[]
    : T extends object
      ? { readonly [K in keyof T]: Widen<T[K]> }
      : T;

export const announcementWorkspaceEn = {
  presentation: {
    priority: {
      LOW: 'Low',
      NORMAL: 'Normal',
      HIGH: 'High',
      URGENT: 'Urgent',
      other: 'Other',
    },
    role: {
      STUDENT: 'Student',
      LECTURER: 'Lecturer',
      ADMIN: 'Administrator',
      SUPER_ADMIN: 'Super administrator',
      other: 'Other audience',
    },
    history: {
      CREATED: 'Created',
      UPDATED: 'Edited',
      ARCHIVED: 'Archived',
      RESTORED: 'Restored',
      other: 'Changed',
    },
    historyReason: {
      created: 'Announcement created',
      archivedCompat: 'Archived by a compatibility action',
      displayOrder: 'Display order set to {order}',
    },
    audience: {
      campusWide: 'Campus-wide',
      none: 'No audience selected',
    },
    audienceBadge: {
      global: '🌐 Campus-wide Notice',
      student: '🎓 Student Dedicated',
      lecturer: '👨‍🏫 Faculty & Lecturer',
      other: 'Specialized Notice',
    },
    salutation: {
      student: 'All students and trainees of the University',
      lecturer: 'All Faculty Members, Lecturers, and Researchers of the University',
      global: 'All faculty members, staff, researchers, and students of the University',
    },
    publisher: {
      informationTechnology: 'Faculty of Information Technology & Academic Affairs Office',
    },
    semesterPrefix: 'Semester',
    readingTime: {
      oneMinute: '1 min read',
      minutes: '{minutes} min read ({words} words)',
    },
    relativeTime: {
      justNow: 'Just now',
      minutesAgo: '{minutes}m ago',
      hoursAgo: '{hours}h ago',
      yesterday: 'Yesterday',
      daysAgo: '{days}d ago',
    },
  },
  covers: {
    campus: { title: 'HCMUTE Campus Academic', tag: 'Campus' },
    notice: { title: 'Academic Notice Bulletin', tag: 'Notice' },
    thesis: { title: 'Thesis Defense Committee', tag: 'Thesis' },
    council: { title: 'Thesis Evaluation Council', tag: 'Council' },
    faculty: { title: 'Faculty of Engineering Hall', tag: 'Faculty' },
    library: { title: 'Smart Digital Library & Commons', tag: 'Library' },
    convocation: { title: 'Grand Convocation Ceremony', tag: 'Graduation' },
    lab: { title: 'IT Smart Systems Lab', tag: 'Research' },
  },
  composer: {
    validationTitle: 'Please enter a title',
    validationContent: 'Please enter document content',
    quickEditReason: 'Quick edit via Admin Announcements',
    saveFailed: 'Failed to save changes. Please retry.',
    title: 'Edit Announcement',
    noticeId: 'Notice ID:',
    publishedBy: 'Published by:',
    defaultPublisher: 'Office of Academic Affairs',
    titleLabel: 'Document Title',
    titlePlaceholder: 'Enter official document title...',
    priorityLabel: 'Priority',
    priority: {
      URGENT: 'Urgent',
      HIGH: 'High',
      NORMAL: 'Normal',
      LOW: 'Low',
    },
    audienceLabel: 'Target Audience',
    audience: {
      ALL: 'All Campus',
      BOTH: 'Students & Lecturers (targeted)',
      STUDENT: 'Students only',
      LECTURER: 'Lecturers only',
    },
    coverLabel: 'Editorial Cover Image (HCMUTE Collection):',
    removeCover: 'Remove Cover',
    contentLabel: 'Document Content',
    modes: {
      visual: 'Visual',
      code: 'Code',
      preview: 'Preview',
    },
    visualPlaceholder: 'Compose document content...',
    bodyPlaceholder: 'Enter document content...',
    words: 'words',
    characters: 'characters',
    markupHint: 'Supports e-Office standard markup',
    studioTooltip: 'Open in Advanced Studio',
    studioAction: 'Open in Studio',
    cancel: 'Cancel',
    saving: 'Saving...',
    save: 'Save Changes',
    lecturer: {
      validationTitle: 'Please enter a title',
      validationContent: 'Please enter notice content',
      validationSection: 'Please select the class section for this notice',
      submittedForReview: 'Notice submitted for review — another reviewer publishes it.',
      draftSaved: 'Draft saved — submit it for review from your notices list.',
      saveFailed: 'Could not save the notice. Please try again.',
      title: 'Draft announcement for students',
      presetLabel: 'Select quick academic template:',
      sectionLabel: 'Target class section *',
      loadingSections: 'Loading your class sections...',
      loadSectionsFailed: 'Could not load your class sections.',
      retry: 'Retry',
      noSections: 'You have no assigned class sections — posting is unavailable.',
      selectSection: '— Select a class section —',
      sectionWord: 'Section',
      priorityLabel: 'Priority',
      priority: {
        NORMAL: 'Normal',
        HIGH: 'High',
        URGENT: 'Urgent',
        LOW: 'Low',
      },
      audienceLabel: 'Target Audience',
      students: 'Students',
      titleLabel: 'Notice Title *',
      titlePlaceholder: 'Enter notice title...',
      coverLabel: 'Editorial Cover Image (HCMUTE Collection):',
      removeCover: 'Remove Cover',
      contentLabel: 'Notice Content * (TinyMCE WYSIWYG & HTML)',
      modes: {
        visual: 'Visual',
        code: 'Code',
        preview: 'Preview',
      },
      visualPlaceholder: 'Compose academic notice for students...',
      bodyPlaceholder: 'Enter notice body (HTML or plain text)...',
      cancel: 'Cancel',
      saveDraft: 'Save draft',
      submitting: 'Submitting...',
      submitReview: 'Submit for review',
    },
  },
  templates: {
    body: {
      LEAVE_MAKEUP: `<p>Dear students of the course section,</p>
<p>The instructor announces a class postponement and the makeup session plan as follows:</p>
<ul>
  <li><strong>Postponed session:</strong> Class on ... (Day ..., Period ...).</li>
  <li><strong>Reason:</strong> Urgent academic or professional duty.</li>
  <li><strong>Makeup session plan:</strong> Scheduled for Day ..., date ... (Period ...) at room ... / online via MS Teams.</li>
</ul>
<p>Class representatives are requested to notify all students to ensure full attendance.</p>
<p>Best regards./.</p>`,
      ASSIGNMENT_DEADLINE: `<p>Dear students and course project teams,</p>
<p>This is a reminder regarding the deadline and submission requirements for the major assignment / course project:</p>
<ul>
  <li><strong>Submission deadline:</strong> 23:59 on ... (The submission portal will close automatically after this deadline).</li>
  <li><strong>Submission deliverables:</strong> PDF report, presentation slides, and source code archive named: <code>[Group_XX]_[CourseCode].zip</code>.</li>
  <li><strong>Note:</strong> Late submissions without prior valid approval will be penalized per course regulations. Any technical issues must be reported to the instructor before the deadline.</li>
</ul>
<p>Wishing you productive completion and high marks on your submission./.</p>`,
      EXAM_SCHEDULE: `<p>Dear students,</p>
<p>The midterm exam schedule (accounting for 50% of the course continuous assessment) is arranged as follows:</p>
<ul>
  <li><strong>Exam schedule:</strong> Period ..., Day ..., date ... in room ...</li>
  <li><strong>Exam format:</strong> Multiple-choice combined with constructed response (Duration: 60 minutes).</li>
  <li><strong>Scope:</strong> Core topics from Chapter 1 through Chapter ...</li>
  <li><strong>Regulations:</strong> Students must present their Student ID or National ID card; no unauthorized reference materials allowed in the exam room.</li>
</ul>
<p>Please prepare thoroughly to achieve your best performance./.</p>`,
      COURSE_GENERAL: `<p>Dear students of the course section,</p>
<p>Please note the following important updates and guidelines for the upcoming academic week:</p>
<ul>
  <li>Lecture slides and lab practice materials for this week have been uploaded to the portal.</li>
  <li>Please read the assigned materials prior to class.</li>
  <li>Ensure all required software and development tools are set up on your personal laptops.</li>
</ul>
<p>If you have questions, please ask during class or contact the instructor by email.</p>
<p>Wishing you an effective and rewarding study week./.</p>`,
    },
  },
  lecturer: {
    eyebrow: 'Lecturer area',
    title: 'Teaching & Research Notices',
    description:
      'Dedicated announcement board for faculty members regarding academic planning, exams, grading, and scientific research.',
    backToDashboard: 'Back to lecturer dashboard',
    refresh: 'Refresh',
    loading: 'Loading announcements',
    unavailableTitle: 'Announcements unavailable',
    emptyTitle: 'No matching notices found',
    emptyDescription:
      'There are no announcements matching your selected category or search keywords.',
    recentNotices: 'Official Notice Feed',
    semesterPrefix: 'Semester',
    sectionPrefix: 'Class',
    loadFailed: 'Announcements could not be loaded right now.',
    readFull: 'Read full notice',
    officialBadge: 'Faculty of IT & Academic Office',
    searchPlaceholder: 'Search teaching notices, exams, research...',
    filterAll: 'All notices',
    filterGlobal: '🌐 Campus-wide',
    filterLecturerOnly: '👨‍🏫 Faculty dedicated',
    filterExamGrades: 'Exams & Gradebook',
    filterResearch: 'Research & Syllabus',
    loadMore: 'Load more notices',
    loadingMore: 'Loading more…',
    loadMoreFailed: 'Could not load more — press again to retry.',
    queueTitle: 'My notices & review queue',
    queueEmpty: 'No notices in this status group yet.',
    queueLoadFailed: 'Your notices could not be loaded.',
    queueOwnBadge: 'Mine',
    queueReviewBadge: 'Awaiting review',
    queueCancel: 'Cancel',
    draftAction: 'Draft student announcement',
    updated: 'Updated',
    transitionFailed: 'Could not transition the notice. Please try again.',
    returnFailed: 'Could not return the notice to draft. Please try again.',
    archiveTitle: 'Archive this notice?',
    archiveMessage: 'The notice will be archived and students will no longer see it in the feed.',
    archiveConfirm: 'Archive',
    archiveCancel: 'Cancel',
    archiveAction: 'Archive',
    archiving: 'Archiving…',
    archived: 'Notice archived',
    archiveFailed: 'Could not archive the notice. Please try again.',
  },
  reader: {
    toolbar: {
      modeMagazineTitle: 'Academic Magazine View',
      modeMagazine: 'Magazine',
      modeDispatchTitle: 'Official Institutional Dispatch',
      modeDispatch: 'Dispatch',
      fontDecreaseTitle: 'Decrease font size',
      fontDecreaseLabel: 'Decrease font size',
      fontIncreaseTitle: 'Increase font size',
      fontIncreaseLabel: 'Increase font size',
      fontSerifActive: 'Serif font. Click for Sans.',
      fontSansActive: 'Sans font. Click for Serif.',
      themeLight: 'Light background',
      themeSepia: 'Warm eye-care Sepia mode',
      themeDark: 'Dark mode',
      editTitle: 'Edit announcement',
      editAction: 'Edit',
      printTitle: 'Print document',
      printAction: 'Print',
      shareTitle: 'Copy notice link',
      copied: 'Copied!',
      copyFailed: 'Could not copy the link',
      shareAction: 'Share',
      closeTitle: 'Close reader (Esc)',
      closeLabel: 'Close reader',
    },
    toc: {
      ariaLabel: 'Table of contents',
      heading: 'Table of Contents',
      countSuffix: 'sections',
    },
    related: {
      heading: 'Related & Notable Articles',
      read: 'Read',
    },
    attachments: {
      heading: 'Official Attached Documents',
      countSuffix: 'files',
      digitalDocument: 'Digital document',
    },
    progress: {
      label: 'Reading progress',
    },
    dispatch: {
      ministryName: 'MINISTRY OF EDUCATION AND TRAINING',
      universityName: 'HO CHI MINH CITY UNIVERSITY OF TECHNOLOGY AND ENGINEERING',
      departmentName: 'FACULTY OF IT & ACADEMIC AFFAIRS OFFICE',
      nationalMotto1: 'SOCIALIST REPUBLIC OF VIETNAM',
      nationalMotto2: 'Independence - Freedom - Happiness',
      datePrefix: 'Ho Chi Minh City, {date}',
      docRef: 'Ref: {ref}',
      officialDocBadge: 'OFFICIAL DOCUMENT',
      noticeHeader: 'ANNOUNCEMENT',
      audience: 'Target audience',
      section: 'Section',
      salutation: 'To',
      issuedByLabel: 'Issuing unit',
      signOffHint: 'Published electronically on the Campus Portal',
    },
    magazine: {
      featured: 'Featured',
      universityName: 'Ho Chi Minh City University of Technology and Engineering',
    },
  },
  feed: {
    featured: 'Featured',
    urgent: 'Urgent',
    urgentHigh: 'Urgent',
    readMinutes: 'min read',
    readMinutesShort: 'm',
    copyLink: 'Copy link',
    share: 'Share',
    readArticle: 'Read article',
    read: 'Read',
  },
  badge: {
    title: 'Bài viết bằng tiếng Việt / Article in Vietnamese',
  },
  limits: {
    contentTooLong:
      'The content exceeds the {limit} character limit by {excess} characters. Shorten the text or remove an image.',
  },
};

export type AnnouncementWorkspaceCopy = Widen<typeof announcementWorkspaceEn>;

export const announcementWorkspaceVi: AnnouncementWorkspaceCopy = {
  presentation: {
    priority: {
      LOW: 'Thấp',
      NORMAL: 'Bình thường',
      HIGH: 'Cao',
      URGENT: 'Khẩn cấp',
      other: 'Khác',
    },
    role: {
      STUDENT: 'Sinh viên',
      LECTURER: 'Giảng viên',
      ADMIN: 'Quản trị viên',
      SUPER_ADMIN: 'Quản trị viên cấp cao',
      other: 'Đối tượng khác',
    },
    history: {
      CREATED: 'Đã tạo',
      UPDATED: 'Đã chỉnh sửa',
      ARCHIVED: 'Đã lưu trữ',
      RESTORED: 'Đã khôi phục',
      other: 'Đã thay đổi',
    },
    historyReason: {
      created: 'Khởi tạo thông báo',
      archivedCompat: 'Lưu trữ thông báo',
      displayOrder: 'Đặt thứ tự hiển thị thành {order}',
    },
    audience: {
      campusWide: 'Toàn trường',
      none: 'Chưa chọn đối tượng',
    },
    audienceBadge: {
      global: '🌐 Thông báo toàn trường',
      student: '🎓 Dành riêng cho Sinh viên',
      lecturer: '👨‍🏫 Nghiệp vụ Giảng viên',
      other: 'Thông báo chuyên biệt',
    },
    salutation: {
      student: 'Toàn thể sinh viên, học viên Nhà trường',
      lecturer: 'Quý Thầy/Cô, Cán bộ giảng dạy và Nghiên cứu viên Nhà trường',
      global: 'Toàn thể cán bộ, giảng viên, học viên và sinh viên Nhà trường',
    },
    publisher: {
      informationTechnology: 'Khoa Công nghệ Thông tin & Phòng Đào Tạo',
    },
    semesterPrefix: 'Học kỳ',
    readingTime: {
      oneMinute: '1 phút đọc',
      minutes: '{minutes} phút đọc ({words} từ)',
    },
    relativeTime: {
      justNow: 'Vừa xong',
      minutesAgo: '{minutes} phút trước',
      hoursAgo: '{hours} giờ trước',
      yesterday: 'Hôm qua',
      daysAgo: '{days} ngày trước',
    },
  },
  covers: {
    campus: { title: 'Khuôn viên học thuật HCMUTE', tag: 'Khuôn viên' },
    notice: { title: 'Bản tin thông báo học vụ', tag: 'Học vụ' },
    thesis: { title: 'Hội đồng bảo vệ khóa luận', tag: 'Khóa luận' },
    council: { title: 'Hội đồng đánh giá đề tài', tag: 'Hội đồng' },
    faculty: { title: 'Tòa nhà Khoa Kỹ thuật HCMUTE', tag: 'Khoa Viện' },
    library: { title: 'Thư viện số & Không gian học tập', tag: 'Thư viện' },
    convocation: { title: 'Lễ tốt nghiệp & Vinh danh học thuật', tag: 'Tốt nghiệp' },
    lab: { title: 'Phòng Lab nghiên cứu Khoa CNTT', tag: 'Nghiên cứu' },
  },
  composer: {
    validationTitle: 'Vui lòng nhập tiêu đề thông báo / công văn',
    validationContent: 'Vui lòng nhập nội dung văn bản',
    quickEditReason: 'Chỉnh sửa nhanh qua giao diện quản trị Bảng tin',
    saveFailed: 'Không thể lưu thay đổi. Vui lòng kiểm tra lại.',
    title: 'Chỉnh sửa thông báo / công văn',
    noticeId: 'Mã văn bản:',
    publishedBy: 'Ban hành bởi:',
    defaultPublisher: 'Phòng Đào tạo',
    titleLabel: 'Tiêu đề thông báo / công văn',
    titlePlaceholder: 'Nhập tiêu đề công văn chính thức...',
    priorityLabel: 'Mức độ ưu tiên',
    priority: {
      URGENT: 'Khẩn cấp (Urgent)',
      HIGH: 'Ưu tiên cao (High)',
      NORMAL: 'Bình thường (Normal)',
      LOW: 'Thông tin chung (Low)',
    },
    audienceLabel: 'Đối tượng tiếp nhận',
    audience: {
      ALL: 'Toàn trường (Sinh viên & Giảng viên)',
      BOTH: 'Sinh viên & Giảng viên (không toàn trường)',
      STUDENT: 'Chỉ Sinh viên',
      LECTURER: 'Chỉ Giảng viên',
    },
    coverLabel: 'Ảnh bìa học thuật (Bộ sưu tập HCMUTE):',
    removeCover: 'Gỡ ảnh bìa',
    contentLabel: 'Nội dung công văn / văn bản',
    modes: {
      visual: 'Trực quan (TinyMCE)',
      code: 'Mã nguồn',
      preview: 'Xem trước',
    },
    visualPlaceholder: 'Soạn thảo nội dung văn bản chuẩn học thuật...',
    bodyPlaceholder: 'Nhập nội dung văn bản...',
    words: 'từ',
    characters: 'ký tự',
    markupHint: 'Hỗ trợ định dạng văn bản chuẩn e-Office',
    studioTooltip: 'Chuyển sang Studio kéo thả khối đầy đủ',
    studioAction: 'Mở trong Studio Soạn thảo',
    cancel: 'Hủy',
    saving: 'Đang lưu...',
    save: 'Lưu thay đổi',
    lecturer: {
      validationTitle: 'Vui lòng nhập tiêu đề thông báo',
      validationContent: 'Vui lòng nhập nội dung thông báo',
      validationSection: 'Vui lòng chọn lớp học phần nhận thông báo',
      submittedForReview:
        'Đã gửi thông báo vào hàng chờ duyệt — người duyệt khác sẽ xuất bản.',
      draftSaved: 'Đã lưu bản nháp — gửi duyệt từ danh sách bài của bạn.',
      saveFailed: 'Không thể lưu thông báo. Vui lòng thử lại.',
      title: 'Soạn thông báo gửi sinh viên lớp học phần',
      presetLabel: 'Chọn mẫu học vụ soạn nhanh:',
      sectionLabel: 'Lớp học phần nhận thông báo *',
      loadingSections: 'Đang tải danh sách lớp học phần...',
      loadSectionsFailed: 'Không tải được danh sách lớp học phần.',
      retry: 'Thử lại',
      noSections:
        'Bạn chưa được phân công lớp học phần nào — chưa thể đăng thông báo.',
      selectSection: '— Chọn lớp học phần —',
      sectionWord: 'Lớp',
      priorityLabel: 'Mức độ ưu tiên',
      priority: {
        NORMAL: 'Thông thường (NORMAL)',
        HIGH: 'Quan trọng (HIGH)',
        URGENT: 'Khẩn cấp (URGENT)',
        LOW: 'Tham khảo (LOW)',
      },
      audienceLabel: 'Đối tượng nhận thông báo',
      students: 'Sinh viên các lớp học phần',
      titleLabel: 'Tiêu đề thông báo *',
      titlePlaceholder: 'Nhập tiêu đề thông báo...',
      coverLabel: 'Ảnh bìa học thuật (Bộ sưu tập HCMUTE):',
      removeCover: 'Gỡ ảnh bìa',
      contentLabel: 'Nội dung thông báo * (Hỗ trợ TinyMCE trực quan & HTML)',
      modes: {
        visual: 'Trực quan (TinyMCE)',
        code: 'Mã nguồn',
        preview: 'Xem trước',
      },
      visualPlaceholder:
        'Soạn thảo nội dung thông báo chuẩn học thuật gửi đến sinh viên...',
      bodyPlaceholder:
        'Nhập nội dung thông báo gửi đến sinh viên (mã HTML hoặc văn bản)...',
      cancel: 'Hủy bỏ',
      saveDraft: 'Lưu bản nháp',
      submitting: 'Đang gửi duyệt...',
      submitReview: 'Gửi duyệt',
    },
  },
  templates: {
    body: {
      LEAVE_MAKEUP: `<p>Kính gửi các bạn sinh viên lớp học phần,</p>
<p>Giảng viên phụ trách thông báo về việc hoãn buổi học và kế hoạch học bù như sau:</p>
<ul>
  <li><strong>Thời gian nghỉ:</strong> Buổi học ngày ... (Thứ ..., Tiết ...).</li>
  <li><strong>Lý do:</strong> Công tác chuyên môn đột xuất của Giảng viên.</li>
  <li><strong>Kế hoạch học bù:</strong> Buổi học bù dự kiến diễn ra vào Thứ ..., ngày ... (Tiết ...) tại phòng học ... / học trực tuyến qua MS Teams.</li>
</ul>
<p>Đề nghị ban cán sự lớp thông báo đến toàn thể các bạn sinh viên trong lớp để nắm thông tin và tham gia học bù đầy đủ.</p>
<p>Trân trọng cảm ơn các em./.</p>`,
      ASSIGNMENT_DEADLINE: `<p>Kính gửi sinh viên các nhóm lớp học phần,</p>
<p>Giảng viên xin nhắc nhở về thời hạn và quy cách nộp sản phẩm Bài tập lớn / Đồ án môn học như sau:</p>
<ul>
  <li><strong>Hạn chót nộp bài:</strong> 23h59 ngày ... (Hệ thống sẽ tự động khóa nộp bài sau thời gian này).</li>
  <li><strong>Hồ sơ nộp gồm:</strong> Báo cáo định dạng PDF, Slide thuyết trình và Mã nguồn đính kèm đặt tên theo cú pháp: <code>[Nhom_XX]_[TenMonHoc].zip</code>.</li>
  <li><strong>Lưu ý:</strong> Mọi trường hợp nộp muộn vì lý do cá nhân không chính đáng sẽ bị trừ điểm theo quy định. Các nhóm gặp sự cố kỹ thuật cần báo ngay cho giảng viên trước hạn chót.</li>
</ul>
<p>Chúc các bạn hoàn thành bài tập đúng tiến độ và đạt kết quả cao./.</p>`,
      EXAM_SCHEDULE: `<p>Kính gửi các bạn sinh viên,</p>
<p>Kế hoạch bài kiểm tra giữa kỳ (chiếm 50% điểm quá trình học phần) được sắp xếp cụ thể như sau:</p>
<ul>
  <li><strong>Thời gian kiểm tra:</strong> Tiết ..., Thứ ..., ngày ... tại phòng học ...</li>
  <li><strong>Hình thức:</strong> Bài kiểm tra trắc nghiệm kết hợp tự luận (Thời gian làm bài: 60 phút).</li>
  <li><strong>Nội dung trọng tâm:</strong> Toàn bộ kiến thức từ Chương 1 đến Chương ...</li>
  <li><strong>Quy định:</strong> Sinh viên mang theo Thẻ sinh viên hoặc CCCD để đối chiếu; không sử dụng tài liệu trong phòng thi.</li>
</ul>
<p>Đề nghị các bạn sinh viên chuẩn bị chu đáo để làm bài đạt kết quả tốt nhất./.</p>`,
      COURSE_GENERAL: `<p>Kính gửi các bạn sinh viên lớp học phần,</p>
<p>Giảng viên gửi đến các bạn một số thông tin và dặn dò quan trọng cho tuần học tiếp theo:</p>
<ul>
  <li>Đã tải lên Slide bài giảng và bài tập thực hành tuần này lên hệ thống.</li>
  <li>Các bạn sinh viên vui lòng đọc trước tài liệu trước khi đến lớp.</li>
  <li>Chuẩn bị sẵn môi trường cài đặt phần mềm trên laptop cá nhân.</li>
</ul>
<p>Nếu có thắc mắc trong quá trình làm bài, các bạn có thể trao đổi trong giờ học hoặc gửi email cho giảng viên.</p>
<p>Chúc các bạn có một tuần học tập hiệu quả./.</p>`,
    },
  },
  lecturer: {
    eyebrow: 'Cổng Giảng viên',
    title: 'Thông báo Giảng dạy & Nghiên cứu',
    description:
      'Cổng thông báo chuyên trách dành cho Cán bộ giảng dạy về kế hoạch đào tạo, lịch coi thi, nhập điểm và nghiên cứu khoa học.',
    backToDashboard: 'Quay lại trang tổng quan giảng viên',
    refresh: 'Làm mới',
    loading: 'Đang tải thông báo',
    unavailableTitle: 'Thông báo chưa sẵn sàng',
    emptyTitle: 'Không tìm thấy thông báo phù hợp',
    emptyDescription:
      'Không có thông báo nào khớp với bộ lọc hoặc từ khóa tìm kiếm của Thầy/Cô.',
    recentNotices: 'Bảng Tin Thông Báo Chính Thức',
    semesterPrefix: 'Học kỳ',
    sectionPrefix: 'Lớp học phần',
    loadFailed: 'Hiện chưa thể tải thông báo.',
    readFull: 'Đọc toàn văn',
    officialBadge: 'Khoa CNTT & Phòng Đào Tạo',
    searchPlaceholder: 'Tìm kiếm thông báo nghiệp vụ, khảo thí, đề tài...',
    filterAll: 'Tất cả thông báo',
    filterGlobal: '🌐 Thông báo toàn trường',
    filterLecturerOnly: '👨‍🏫 Nghiệp vụ Giảng viên',
    filterExamGrades: 'Khảo thí & Sổ điểm',
    filterResearch: 'NCKH & Đề cương',
    loadMore: 'Tải thêm thông báo',
    loadingMore: 'Đang tải thêm…',
    loadMoreFailed: 'Chưa tải thêm được — nhấn lại để thử.',
    queueTitle: 'Bài của tôi & hàng chờ duyệt',
    queueEmpty: 'Chưa có bài nào trong nhóm trạng thái này.',
    queueLoadFailed: 'Chưa tải được danh sách bài của bạn.',
    queueOwnBadge: 'Bài của tôi',
    queueReviewBadge: 'Chờ duyệt',
    queueCancel: 'Hủy',
    draftAction: 'Soạn thông báo cho sinh viên',
    updated: 'Đã cập nhật',
    transitionFailed: 'Không thể chuyển trạng thái thông báo. Vui lòng thử lại.',
    returnFailed: 'Không thể trả thông báo về nháp. Vui lòng thử lại.',
    archiveTitle: 'Lưu trữ thông báo?',
    archiveMessage:
      'Thông báo sẽ được đưa vào lưu trữ và sinh viên không còn thấy trên bảng tin.',
    archiveConfirm: 'Lưu trữ',
    archiveCancel: 'Hủy',
    archiveAction: 'Lưu trữ',
    archiving: 'Đang lưu trữ…',
    archived: 'Đã lưu trữ thông báo',
    archiveFailed: 'Không thể lưu trữ thông báo. Vui lòng thử lại.',
  },
  reader: {
    toolbar: {
      modeMagazineTitle: 'Giao diện Báo chí Học thuật',
      modeMagazine: 'Dạng Bản tin',
      modeDispatchTitle: 'Giao diện Công văn Hành chính e-Office',
      modeDispatch: 'Công văn',
      fontDecreaseTitle: 'Giảm cỡ chữ (A-)',
      fontDecreaseLabel: 'Giảm cỡ chữ',
      fontIncreaseTitle: 'Tăng cỡ chữ (A+)',
      fontIncreaseLabel: 'Tăng cỡ chữ',
      fontSerifActive: 'Đang dùng phông có chân (Serif). Bấm để đổi sang Sans.',
      fontSansActive: 'Đang dùng phông không chân (Sans). Bấm để đổi sang Serif.',
      themeLight: 'Nền sáng tiêu chuẩn',
      themeSepia: 'Nền Sepia dịu mắt ban đêm',
      themeDark: 'Nền tối chống chói',
      editTitle: 'Chỉnh sửa bài viết',
      editAction: 'Chỉnh sửa',
      printTitle: 'In tài liệu (chuẩn khổ A4)',
      printAction: 'In',
      shareTitle: 'Sao chép liên kết bài viết',
      copied: 'Đã chép!',
      copyFailed: 'Không chép được liên kết',
      shareAction: 'Chia sẻ',
      closeTitle: 'Đóng cửa sổ đọc (Esc)',
      closeLabel: 'Đóng cửa sổ đọc',
    },
    toc: {
      ariaLabel: 'Mục lục bài viết',
      heading: 'Mục lục bài viết',
      countSuffix: 'phần',
    },
    related: {
      heading: 'Bài viết liên quan & Đáng chú ý',
      read: 'Đọc tiếp',
    },
    attachments: {
      heading: 'Tệp đính kèm chính thức',
      countSuffix: 'tệp',
      digitalDocument: 'Tài liệu số',
    },
    progress: {
      label: 'Tiến trình đọc bài viết',
    },
    dispatch: {
      ministryName: 'BỘ GIÁO DỤC VÀ ĐÀO TẠO',
      universityName: 'TRƯỜNG ĐẠI HỌC CÔNG NGHỆ KỸ THUẬT TP.HCM',
      departmentName: 'KHOA CÔNG NGHỆ THÔNG TIN & PHÒNG ĐÀO TẠO',
      nationalMotto1: 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM',
      nationalMotto2: 'Độc lập - Tự do - Hạnh phúc',
      datePrefix: 'TP. Hồ Chí Minh, ngày {date}',
      docRef: 'Số: {ref}',
      officialDocBadge: 'VĂN BẢN ĐIỆN TỬ',
      noticeHeader: 'THÔNG BÁO',
      audience: 'Đối tượng áp dụng',
      section: 'Lớp học phần',
      salutation: 'Kính gửi',
      issuedByLabel: 'Đơn vị ban hành',
      signOffHint: 'Thông báo được ban hành điện tử trên Cổng học vụ',
    },
    magazine: {
      featured: 'Tiêu điểm',
      universityName: 'Trường Đại học Công nghệ Kỹ thuật TP.HCM',
    },
  },
  feed: {
    featured: 'Bài viết tiêu điểm',
    urgent: 'Khẩn',
    urgentHigh: 'Ưu tiên cao',
    readMinutes: 'phút đọc',
    readMinutesShort: 'phút',
    copyLink: 'Sao chép liên kết',
    share: 'Chia sẻ',
    readArticle: 'Đọc toàn văn',
    read: 'Đọc bài',
  },
  badge: {
    title: 'Bài viết bằng tiếng Việt / Article in Vietnamese',
  },
  limits: {
    contentTooLong:
      'Nội dung vượt quá giới hạn {limit} ký tự (cần bỏ bớt {excess} ký tự). Hãy rút gọn văn bản hoặc bỏ bớt hình ảnh.',
  },
};
