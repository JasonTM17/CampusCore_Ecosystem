import { buildSiteUrl } from '@/lib/site';

export default function Head() {
  return (
    <>
      <title>Reset password | CampusCore</title>
      <meta
        name="description"
        content="Set a new CampusCore password and return to the workspace."
      />
      <meta name="robots" content="noindex, nofollow" />
      <link rel="canonical" href={buildSiteUrl('/reset-password')} />
    </>
  );
}
