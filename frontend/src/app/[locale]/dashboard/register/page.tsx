import { redirect } from 'next/navigation';

/** Legacy dashboard route — the registrar workspace lives at /{locale}/dang-ky-hoc-phan. */
export default async function DashboardRegisterRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const { q } = await searchParams;
  const course = Array.isArray(q) ? q[0] : q;
  redirect(
    `/${locale}/dang-ky-hoc-phan${course ? `?q=${encodeURIComponent(course)}` : ''}`,
  );
}
