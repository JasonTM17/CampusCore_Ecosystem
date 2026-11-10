export type NotificationsCenterLocale = 'en' | 'vi';

const en = {
  offlineReadOnly: 'Read only while offline. Marking read and deleting need a connection.',
  openHint: 'Opens the related screen',
  openRelated: 'Open related feature',
  refresh: 'Refresh notifications',
};

const vi = {
  offlineReadOnly: 'Chỉ xem khi ngoại tuyến. Đánh dấu đã đọc và xóa cần kết nối.',
  openHint: 'Mở màn hình liên quan',
  openRelated: 'Mở tính năng liên quan',
  refresh: 'Làm mới thông báo',
} satisfies Record<keyof typeof en, string>;

export const notificationsCenterMessages = { en, vi };
