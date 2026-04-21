import { buildSiteUrl } from '@/lib/site';

export default function Head() {
  return (
    <>
      <title>Sign in | CampusCore</title>
      <meta
        name="description"
        content="Sign in to CampusCore with your campus account."
      />
      <meta name="robots" content="noindex, nofollow" />
      <link rel="canonical" href={buildSiteUrl('/login')} />
    </>
  );
}
