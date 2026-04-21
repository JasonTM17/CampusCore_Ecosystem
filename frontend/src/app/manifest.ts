import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'CampusCore',
    short_name: 'CampusCore',
    description:
      'CampusCore is a campus operations workspace for secure identity, academics, finance, engagement, and analytics.',
    start_url: '/',
    display: 'standalone',
    background_color: '#101826',
    theme_color: '#101826',
    categories: ['education', 'productivity', 'business'],
  };
}
