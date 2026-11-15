import { redirect } from 'next/navigation';

/** Legacy dashboard route — the registrar workspace lives at /{locale}/dang-ky-hoc-phan. */
export default async function DashboardRegisterRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/dang-ky-hoc-phan`);
}
