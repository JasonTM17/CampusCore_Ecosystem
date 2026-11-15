import { redirect } from 'next/navigation';

/** Legacy dashboard route — the registrar workspace lives at /dang-ky-hoc-phan. */
export default function DashboardRegisterRedirect() {
  redirect('/dang-ky-hoc-phan');
}
