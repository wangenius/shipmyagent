import Link from 'next/link';

export function DocsFooter() {
  return (
    <footer className="mt-16 pt-8 border-t border-fd-border">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
        <div>
          <h4 className="font-semibold mb-3">Getting Started</h4>
          <ul className="space-y-2 text-sm text-fd-muted-foreground">
            <li>
              <Link href="/docs/getting-started/installation" className="hover:text-fd-primary transition-colors">
                Installation
              </Link>
            </li>
            <li>
              <Link href="/docs/getting-started/quick-start" className="hover:text-fd-primary transition-colors">
                Quick Start
              </Link>
            </li>
            <li>
              <Link href="/docs/getting-started/first-agent" className="hover:text-fd-primary transition-colors">
                First Agent
              </Link>
            </li>
          </ul>
        </div>
        
        <div>
          <h4 className="font-semibold mb-3">Core Concepts</h4>
          <ul className="space-y-2 text-sm text-fd-muted-foreground">
            <li>
              <Link href="/docs/core-concepts/hero" className="hover:text-fd-primary transition-colors">
                Hero
              </Link>
            </li>
            <li>
              <Link href="/docs/core-concepts/room" className="hover:text-fd-primary transition-colors">
                Room
              </Link>
            </li>
            <li>
              <Link href="/docs/core-concepts/shot" className="hover:text-fd-primary transition-colors">
                Shot
              </Link>
            </li>
            <li>
              <Link href="/docs/core-concepts/codex" className="hover:text-fd-primary transition-colors">
                Codex
              </Link>
            </li>
          </ul>
        </div>
        
        <div>
          <h4 className="font-semibold mb-3">Examples</h4>
          <ul className="space-y-2 text-sm text-fd-muted-foreground">
            <li>
              <Link href="/docs/examples/basic-agent" className="hover:text-fd-primary transition-colors">
                Basic Agent
              </Link>
            </li>
            <li>
              <Link href="/docs/examples/persistent-memory" className="hover:text-fd-primary transition-colors">
                Persistent Memory
              </Link>
            </li>
            <li>
              <Link href="/docs/examples/knowledge-base" className="hover:text-fd-primary transition-colors">
                Knowledge Base
              </Link>
            </li>
          </ul>
        </div>
        
        <div>
          <h4 className="font-semibold mb-3">Resources</h4>
          <ul className="space-y-2 text-sm text-fd-muted-foreground">
            <li>
              <Link href="/docs/api-reference/hero-api" className="hover:text-fd-primary transition-colors">
                API Reference
              </Link>
            </li>
            <li>
              <Link href="/docs/search" className="hover:text-fd-primary transition-colors">
                Search Docs
              </Link>
            </li>
            <li>
              <a 
                href="https://github.com/wangenius/shipmyagent" 
                target="_blank" 
                rel="noopener noreferrer"
                className="hover:text-fd-primary transition-colors"
              >
                GitHub
              </a>
            </li>
            <li>
              <a 
                href="https://github.com/wangenius/shipmyagent/issues" 
                target="_blank" 
                rel="noopener noreferrer"
                className="hover:text-fd-primary transition-colors"
              >
                Report Issue
              </a>
            </li>
          </ul>
        </div>
      </div>
      
      <div className="flex flex-col md:flex-row justify-between items-center pt-6 border-t border-fd-border text-sm text-fd-muted-foreground">
        <div className="mb-4 md:mb-0">
          <p>© 2024 shipmyagent. Built with ❤️ for AI developers.</p>
        </div>
        <div className="flex items-center space-x-4">
          <Link href="/docs" className="hover:text-fd-primary transition-colors">
            Documentation
          </Link>
          <span>•</span>
          <a 
            href="https://github.com/wangenius/shipmyagent" 
            target="_blank" 
            rel="noopener noreferrer"
            className="hover:text-fd-primary transition-colors"
          >
            GitHub
          </a>
          <span>•</span>
          <Link href="/docs/search" className="hover:text-fd-primary transition-colors">
            Search
          </Link>
        </div>
      </div>
    </footer>
  );
}