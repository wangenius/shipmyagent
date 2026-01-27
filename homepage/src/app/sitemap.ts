import { MetadataRoute } from 'next';
import { source } from '@/lib/source';
import { siteConfig } from '@/lib/metadata';

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = source.getPages();
  
  const staticPages = [
    {
      url: siteConfig.url,
      lastModified: new Date(),
      changeFrequency: 'monthly' as const,
      priority: 1,
    },
    {
      url: `${siteConfig.url}/docs`,
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.9,
    },
    {
      url: `${siteConfig.url}/docs/search`,
      lastModified: new Date(),
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    },
  ];

  const documentationPages = pages.map((page) => ({
    url: `${siteConfig.url}${page.url}`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: getPriority(page.url),
  }));

  return [...staticPages, ...documentationPages];
}

function getPriority(url: string): number {
  // Higher priority for important pages
  if (url.includes('/getting-started/')) return 0.9;
  if (url.includes('/core-concepts/')) return 0.8;
  if (url.includes('/examples/')) return 0.8;
  if (url.includes('/guides/')) return 0.7;
  if (url.includes('/api-reference/')) return 0.6;
  
  return 0.5;
}