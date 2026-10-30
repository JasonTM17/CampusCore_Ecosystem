export type NotificationsMessagesLocale = 'en' | 'vi';

const en = {
  permissionTitle: 'Allow notifications',
  permissionRationale: 'Get important updates about your studies and activities you joined.',
  enableAction: 'Enable notifications',
  permissionDenied: 'Notifications are off. You can turn them on in device settings.',
  unavailable: 'Push notifications are not available in this app yet.',
  registrationFailed: 'Notifications could not be enabled. Try again.',
  unregisterFailed: 'Notification preference could not be updated.',
  deviceUpdateFailed: 'This device could not be updated for notifications.',
  openFailed: 'This notification could not be opened.',
};

const vi = {
  permissionTitle: 'Cho phép thông báo',
  permissionRationale: 'Nhận cập nhật quan trọng về việc học và hoạt động bạn đã đăng ký.',
  enableAction: 'Bật thông báo',
  permissionDenied: 'Quyền thông báo đang tắt. Bạn có thể bật trong cài đặt thiết bị.',
  unavailable: 'Thông báo đẩy chưa được bật trên ứng dụng này.',
  registrationFailed: 'Không thể bật thông báo. Hãy thử lại.',
  unregisterFailed: 'Chưa thể cập nhật lựa chọn thông báo.',
  deviceUpdateFailed: 'Không thể cập nhật thiết bị cho thông báo.',
  openFailed: 'Không thể mở thông báo này.',
} satisfies Record<keyof typeof en, string>;

export const notificationsMessages = { en, vi };
