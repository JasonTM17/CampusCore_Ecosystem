import { buildSiteUrl } from '@/lib/site';

export default function Head() {
  return (
    <>
      <title>Dashboard | CampusCore</title>
      <meta
        name="description"
        content="Protected student and lecturer dashboards for CampusCore."
      />
      <meta name="robots" content="noindex, nofollow" />
      <link rel="canonical" href={buildSiteUrl('/dashboard')} />
    </>
  );
}
