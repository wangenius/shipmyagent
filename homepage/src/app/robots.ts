import { MetadataRoute } from 'next';
import { siteConfig } from '@/lib/metadata';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/_next/',
          '/admin/',
          '*.json',
        ],
      },
      {
        userAgent: 'GPTBot',
        allow: [
          '/docs/',
          '/docs/getting-started/',
          '/docs/core-concepts/',
          '/docs/guides/',
          '/docs/examples/',
          '/docs/api-reference/',
        ],
        disallow: [
          '/api/',
          '/_next/',
        ],
      },
    ],
    sitemap: `${siteConfig.url}/sitemap.xml`,
    host: siteConfig.url,
  };
}