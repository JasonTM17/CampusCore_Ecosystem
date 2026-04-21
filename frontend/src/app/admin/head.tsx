import { buildSiteUrl } from '@/lib/site';

export default function Head() {
  return (
    <>
      <title>Admin workspace | CampusCore</title>
      <meta
        name="description"
        content="Protected administration routes for CampusCore."
      />
      <meta name="robots" content="noindex, nofollow" />
      <link rel="canonical" href={buildSiteUrl('/admin')} />
    </>
  );
}
