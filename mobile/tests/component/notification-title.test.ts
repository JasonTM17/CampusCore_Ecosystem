import { stripNotificationTagPrefix } from '../../src/screens/student/notification-title';

describe('stripNotificationTagPrefix', () => {
  it('drops the announcement transport tag', () => {
    expect(stripNotificationTagPrefix('[Announcement] Cập nhật quy định')).toBe('Cập nhật quy định');
  });

  it('drops the Vietnamese tag and ignores case', () => {
    expect(stripNotificationTagPrefix('[THÔNG BÁO] Lịch thi')).toBe('Lịch thi');
    expect(stripNotificationTagPrefix('[announcement]Lịch thi')).toBe('Lịch thi');
  });

  it('keeps a title without a tag', () => {
    expect(stripNotificationTagPrefix('Chào mừng đến CampusUTE')).toBe('Chào mừng đến CampusUTE');
  });

  it('keeps a title that is only the tag', () => {
    expect(stripNotificationTagPrefix('[Announcement]')).toBe('[Announcement]');
  });

  it('keeps the word when it is not a leading tag', () => {
    expect(stripNotificationTagPrefix('Lịch [Announcement] mới')).toBe('Lịch [Announcement] mới');
  });
});
