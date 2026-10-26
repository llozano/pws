import type { NextConfig } from 'next';

const basePath = process.env.PWS_BASE_PATH ?? (process.env.NODE_ENV === 'production' ? '/pws' : '');

const nextConfig: NextConfig = {
  basePath,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  experimental: {
    agentFeedback: true,
  },
  // cacheComponents: true,
  // partialPrefetching: true,
  turbopack: {
    root: process.cwd(),
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
