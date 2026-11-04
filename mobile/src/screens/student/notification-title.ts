const transportTagPrefix = /^\[(?:announcement|thông báo)\]\s*/i;

export function stripNotificationTagPrefix(title: string): string {
  const stripped = title.replace(transportTagPrefix, '');
  return stripped.length > 0 ? stripped : title;
}
