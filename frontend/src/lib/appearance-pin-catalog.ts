import { announcementsApi, type AnnouncementPinOption } from '@/lib/api';

export type PinOptionRow = {
  id: string;
  title: string;
  status?: string | null;
};

export type PinOptionPage = {
  data: PinOptionRow[];
  meta: { page: number; totalPages: number };
};

const PIN_CATALOG_PAGE_SIZE = 50;
/** postOrder is capped at 100 entries, so one capped read resolves every pin. */
const PIN_RESOLUTION_LIMIT = 200;

const toRow = (option: AnnouncementPinOption): PinOptionRow => ({
  id: option.id ?? '',
  title: option.title ?? '',
  status: option.status ?? null,
});

export async function fetchPinOptionPage(
  page: number,
  search: string,
): Promise<PinOptionPage> {
  const response = await announcementsApi.pinOptions({
    page,
    limit: PIN_CATALOG_PAGE_SIZE,
    search: search || undefined,
  });
  return {
    data: (response.data ?? []).map(toRow),
    meta: {
      page: response.meta?.page ?? page,
      totalPages: response.meta?.totalPages ?? 0,
    },
  };
}

export async function fetchPinnedAnnouncementRows(ids: string[]): Promise<PinOptionRow[]> {
  if (ids.length === 0) {
    return [];
  }
  const response = await announcementsApi.pinOptions({
    ids,
    limit: PIN_RESOLUTION_LIMIT,
  });
  // The server answers in display order; the editor renders pins in pin order.
  const rows = new Map((response.data ?? []).map((row) => [row.id ?? '', toRow(row)]));
  return ids.flatMap((id) => {
    const row = rows.get(id);
    return row ? [row] : [];
  });
}
