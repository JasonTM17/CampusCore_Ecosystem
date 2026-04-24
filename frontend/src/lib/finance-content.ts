export function getLocalizedInvoiceItemDescription(
  locale: 'en' | 'vi',
  description: string,
) {
  const normalized = description.trim().toLowerCase();

  if (normalized === 'tuition and campus services') {
    return locale === 'vi' ? 'Học phí và dịch vụ campus' : 'Tuition and campus services';
  }

  return description;
}
