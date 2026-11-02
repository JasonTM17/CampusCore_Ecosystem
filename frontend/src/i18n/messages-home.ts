type Widen<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? readonly Widen<U>[]
    : T extends object
      ? { readonly [K in keyof T]: Widen<T[K]> }
      : T;

export const homeMarketingEn = {
  news: {
    eyebrow: 'CAMPUS PRESS & MAGAZINE',
    title: 'HCMUTE Academic Life & Innovation',
    description:
      'Official academic announcements, research breakthroughs, student initiatives, and university governance updates.',
    viewAllAnnouncements: 'View all announcements',
    allStories: 'All Stories',
    errorTitle: 'Could not load the news feed',
    errorDescription: 'The announcements service is not responding right now. Please retry.',
    emptyTitle: 'No announcements published yet',
    emptyDescription: 'Official academic announcements and institutional news will appear here once published.',
    noMoreStories: 'No more stories in this category',
    specialFeatures: 'Special Feature Stories',
    articleCount: '{count} articles',
    readArticle: 'Read',
    showLess: 'Show Less',
    viewMore: 'View {count} More Stories',
  },
  hero: {
    heroDescription:
      'Centralized academic management system for students, lecturers, and university administrators.',
    footerDescription: 'One campus portal for students, lecturers, and admins.',
  },
} as const;

export type HomeMarketingCopy = Widen<typeof homeMarketingEn>;

export const homeMarketingVi: HomeMarketingCopy = {
  news: {
    eyebrow: 'TẠP CHÍ & BẢN TIN ĐẠI HỌC',
    title: 'Nhịp Sống Học Thuật & Sáng Tạo HCMUTE',
    description:
      'Thông báo học vụ, sự kiện học thuật, thành tựu nghiên cứu khoa học và chính sách đào tạo chính thức từ Trường Đại học Công nghệ Kỹ thuật TP.HCM.',
    viewAllAnnouncements: 'Xem tất cả thông báo',
    allStories: 'Tất cả bài viết',
    errorTitle: 'Chưa tải được bản tin',
    errorDescription: 'Máy chủ thông báo đang không phản hồi. Vui lòng thử lại.',
    emptyTitle: 'Chưa có bản tin nào được công bố',
    emptyDescription:
      'Các thông báo học thuật và tin tức chính thức của Nhà trường sẽ hiển thị tại đây ngay khi được phát hành.',
    noMoreStories: 'Không có thêm bài viết trong danh mục này',
    specialFeatures: 'Phóng sự & Chuyên đề Khác',
    articleCount: '{count} bài viết',
    readArticle: 'Đọc bài',
    showLess: 'Thu gọn bài viết',
    viewMore: 'Xem thêm {count} bài viết khác',
  },
  hero: {
    heroDescription:
      'Hệ thống quản lý học vụ số tập trung dành cho Sinh viên, Giảng viên và Cán bộ Quản trị.',
    footerDescription: 'Một cổng học vụ cho sinh viên, giảng viên và quản trị.',
  },
};
