import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';
import { baseOptions } from '@/app/layout.config';
import { source } from '@/lib/source';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout 
      tree={source.pageTree} 
      {...baseOptions}
      sidebar={{
        banner: (
          <div className="flex flex-col gap-2 rounded-lg border bg-fd-card p-3 text-sm text-fd-card-foreground">
            <p className="font-medium">🚀 Welcome to shipmyagent!</p>
            <p className="text-fd-muted-foreground">
              Build intelligent AI agents with persistent memory and knowledge integration.
            </p>
          </div>
        ),
      }}
    >
      {children}
    </DocsLayout>
  );
}
