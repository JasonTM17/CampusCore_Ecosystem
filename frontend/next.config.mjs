const localEdgeOrigin =
  (process.env.LOCAL_EDGE_ORIGIN || 'http://127.0.0.1:8080').replace(/\/$/, '');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  experimental: {
    serverActions: {
      bodyParser: false,
    },
  },
  images: {
    unoptimized: true,
  },
  async rewrites() {
    if (process.env.NODE_ENV !== 'development') {
      return [];
    }

    return [
      {
        source: '/api/v1/:path*',
        destination: `${localEdgeOrigin}/api/v1/:path*`,
      },
      {
        source: '/api/docs',
        destination: `${localEdgeOrigin}/api/docs`,
      },
      {
        source: '/health',
        destination: `${localEdgeOrigin}/health`,
      },
      {
        source: '/socket.io/:path*',
        destination: `${localEdgeOrigin}/socket.io/:path*`,
      },
      {
        source: '/notifications/:path*',
        destination: `${localEdgeOrigin}/notifications/:path*`,
      },
    ];
  },
};

export default nextConfig;
