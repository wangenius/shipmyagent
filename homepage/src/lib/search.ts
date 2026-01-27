import { source } from '@/lib/source';

export interface SearchResult {
  id: string;
  title: string;
  content: string;
  url: string;
  type: 'page' | 'heading' | 'text';
}

export function createSearchIndex() {
  const pages = source.getPages();
  const searchIndex: SearchResult[] = [];

  pages.forEach((page) => {
    // Add page title as searchable item
    searchIndex.push({
      id: `${page.url}#title`,
      title: page.data.title,
      content: page.data.description || '',
      url: page.url,
      type: 'page',
    });

    // Add structured data (headings) as searchable items
    if (page.data.structuredData) {
      page.data.structuredData.headings.forEach((heading) => {
        searchIndex.push({
          id: `${page.url}#${heading.id}`,
          title: heading.content,
          content: `${page.data.title} - ${heading.content}`,
          url: `${page.url}#${heading.id}`,
          type: 'heading',
        });
      });

      // Add text content as searchable items
      page.data.structuredData.contents.forEach((content, index) => {
        if (content.content && content.content.length > 20) {
          searchIndex.push({
            id: `${page.url}#content-${index}`,
            title: page.data.title,
            content: content.content.substring(0, 200) + '...',
            url: page.url,
            type: 'text',
          });
        }
      });
    }
  });

  return searchIndex;
}

export function searchContent(query: string, limit: number = 10): SearchResult[] {
  const index = createSearchIndex();
  const searchTerms = query.toLowerCase().split(' ').filter(term => term.length > 0);
  
  if (searchTerms.length === 0) {
    return [];
  }

  const results = index
    .map((item) => {
      const titleLower = item.title.toLowerCase();
      const contentLower = item.content.toLowerCase();
      
      let score = 0;
      
      // Title matches get higher score
      searchTerms.forEach((term) => {
        if (titleLower.includes(term)) {
          score += 10;
        }
        if (contentLower.includes(term)) {
          score += 1;
        }
      });
      
      // Exact phrase matches get bonus
      if (titleLower.includes(query.toLowerCase())) {
        score += 20;
      }
      if (contentLower.includes(query.toLowerCase())) {
        score += 5;
      }
      
      return { ...item, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return results;
}