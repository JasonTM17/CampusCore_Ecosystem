export type NotificationsCenterLocale = 'en' | 'vi';

const en = {
  offlineReadOnly: 'Read only while offline. Marking read and deleting need a connection.',
  openHint: 'Opens the related screen',
};

const vi = {
  offlineReadOnly: 'Chỉ xem khi ngoại tuyến. Đánh dấu đã đọc và xóa cần kết nối.',
  openHint: 'Mở màn hình liên quan',
} satisfies Record<keyof typeof en, string>;

export const notificationsCenterMessages = { en, vi };
