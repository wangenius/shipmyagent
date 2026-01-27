import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-center max-w-2xl mx-auto px-6">
        <h1 className="text-8xl font-thin mb-8 text-black">
          shipmyagent
        </h1>
        
        <p className="text-2xl text-gray-600 mb-12 font-light">
          AI Agent 生态系统
        </p>
        
        <div className="space-y-4 mb-12">
          <Link 
            href="/docs/getting-started/installation"
            className="inline-block bg-black text-white px-8 py-3 rounded hover:bg-gray-800 transition-colors"
          >
            开始使用
          </Link>
        </div>
        
        <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-sm font-mono text-gray-700 inline-block">
          npm install shipmyagent
        </div>
      </div>
    </main>
  );
}