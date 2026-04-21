import { buildSiteUrl } from '@/lib/site';

export default function Head() {
  return (
    <>
      <title>Forgot password | CampusCore</title>
      <meta
        name="description"
        content="Request a CampusCore password reset link."
      />
      <meta name="robots" content="noindex, nofollow" />
      <link rel="canonical" href={buildSiteUrl('/forgot-password')} />
    </>
  );
}
