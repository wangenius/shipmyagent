import React from 'react';

// Icon components for consistent visual design
export const Icons = {
  Hero: () => (
    <div className="inline-flex items-center justify-center w-8 h-8 bg-blue-100 text-blue-600 rounded-lg text-lg">
      🤖
    </div>
  ),
  Room: () => (
    <div className="inline-flex items-center justify-center w-8 h-8 bg-green-100 text-green-600 rounded-lg text-lg">
      🏠
    </div>
  ),
  Shot: () => (
    <div className="inline-flex items-center justify-center w-8 h-8 bg-purple-100 text-purple-600 rounded-lg text-lg">
      💬
    </div>
  ),
  Codex: () => (
    <div className="inline-flex items-center justify-center w-8 h-8 bg-orange-100 text-orange-600 rounded-lg text-lg">
      📖
    </div>
  ),
  User: () => (
    <div className="inline-flex items-center justify-center w-8 h-8 bg-gray-100 text-gray-600 rounded-lg text-lg">
      👤
    </div>
  ),
};

// Component cards for visual representation
export function ComponentCard({ 
  icon, 
  title, 
  description, 
  features 
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  features: string[];
}) {
  return (
    <div className="border border-fd-border rounded-lg p-6 hover:bg-fd-muted/50 transition-colors">
      <div className="flex items-center gap-3 mb-4">
        {icon}
        <h3 className="text-lg font-semibold">{title}</h3>
      </div>
      <p className="text-fd-muted-foreground mb-4">{description}</p>
      <ul className="space-y-1">
        {features.map((feature, index) => (
          <li key={index} className="text-sm text-fd-muted-foreground flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-fd-primary rounded-full"></span>
            {feature}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Memory tier visualization
export function MemoryTierDiagram() {
  return (
    <div className="flex flex-col gap-4 p-6 bg-fd-muted/20 rounded-lg">
      <div className="text-center mb-4">
        <h4 className="font-semibold">Memory Hierarchy</h4>
        <p className="text-sm text-fd-muted-foreground">Information flows from immediate to long-term memory</p>
      </div>
      
      <div className="flex flex-col gap-3">
        {/* Tier 1: Shot */}
        <div className="flex items-center gap-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <Icons.Shot />
          <div className="flex-1">
            <div className="font-medium">Tier 1: Shot (Immediate)</div>
            <div className="text-sm text-fd-muted-foreground">Current conversation context</div>
          </div>
          <div className="text-xs text-fd-muted-foreground">~10-50 messages</div>
        </div>
        
        {/* Arrow */}
        <div className="flex justify-center">
          <div className="w-0.5 h-4 bg-fd-border"></div>
        </div>
        
        {/* Tier 2: Room */}
        <div className="flex items-center gap-4 p-4 bg-green-50 border border-green-200 rounded-lg">
          <Icons.Room />
          <div className="flex-1">
            <div className="font-medium">Tier 2: Room (Working)</div>
            <div className="text-sm text-fd-muted-foreground">Cross-session memory</div>
          </div>
          <div className="text-xs text-fd-muted-foreground">~100-1000 interactions</div>
        </div>
        
        {/* Arrow */}
        <div className="flex justify-center">
          <div className="w-0.5 h-4 bg-fd-border"></div>
        </div>
        
        {/* Tier 3: Codex */}
        <div className="flex items-center gap-4 p-4 bg-orange-50 border border-orange-200 rounded-lg">
          <Icons.Codex />
          <div className="flex-1">
            <div className="font-medium">Tier 3: Codex (Long-term)</div>
            <div className="text-sm text-fd-muted-foreground">Knowledge base</div>
          </div>
          <div className="text-xs text-fd-muted-foreground">~1000+ documents</div>
        </div>
      </div>
    </div>
  );
}

// Data flow visualization
export function DataFlowDiagram() {
  return (
    <div className="p-6 bg-fd-muted/20 rounded-lg">
      <h4 className="font-semibold mb-4 text-center">Information Flow</h4>
      
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-center">
        {/* User Input */}
        <div className="flex flex-col items-center gap-2">
          <Icons.User />
          <div className="text-sm font-medium">User</div>
          <div className="text-xs text-fd-muted-foreground text-center">Sends message</div>
        </div>
        
        {/* Arrow */}
        <div className="flex justify-center">
          <div className="w-8 h-0.5 bg-fd-border"></div>
        </div>
        
        {/* Hero Processing */}
        <div className="flex flex-col items-center gap-2">
          <Icons.Hero />
          <div className="text-sm font-medium">Hero</div>
          <div className="text-xs text-fd-muted-foreground text-center">Processes & queries memory</div>
        </div>
        
        {/* Arrow */}
        <div className="flex justify-center">
          <div className="w-8 h-0.5 bg-fd-border"></div>
        </div>
        
        {/* Response */}
        <div className="flex flex-col items-center gap-2">
          <div className="inline-flex items-center justify-center w-8 h-8 bg-blue-100 text-blue-600 rounded-lg text-lg">
            💭
          </div>
          <div className="text-sm font-medium">Response</div>
          <div className="text-xs text-fd-muted-foreground text-center">Enhanced with context</div>
        </div>
      </div>
      
      {/* Memory Access Indicators */}
      <div className="mt-6 flex justify-center gap-8">
        <div className="flex items-center gap-2 text-xs text-fd-muted-foreground">
          <Icons.Shot />
          <span>Immediate context</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-fd-muted-foreground">
          <Icons.Room />
          <span>Past conversations</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-fd-muted-foreground">
          <Icons.Codex />
          <span>Knowledge base</span>
        </div>
      </div>
    </div>
  );
}

// Feature comparison table
export function FeatureComparisonTable() {
  const features = [
    { feature: 'Conversation Handling', hero: '✅', room: '❌', shot: '✅', codex: '❌' },
    { feature: 'Memory Persistence', hero: '❌', room: '✅', shot: '❌', codex: '✅' },
    { feature: 'Knowledge Search', hero: '❌', room: '❌', shot: '❌', codex: '✅' },
    { feature: 'Session Management', hero: '✅', room: '✅', shot: '✅', codex: '❌' },
    { feature: 'Vector Storage', hero: '❌', room: '❌', shot: '❌', codex: '✅' },
    { feature: 'Cross-Session Data', hero: '❌', room: '✅', shot: '❌', codex: '✅' },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full border border-fd-border rounded-lg">
        <thead>
          <tr className="bg-fd-muted/50">
            <th className="text-left p-3 border-b border-fd-border">Feature</th>
            <th className="text-center p-3 border-b border-fd-border">
              <div className="flex items-center justify-center gap-2">
                <Icons.Hero />
                Hero
              </div>
            </th>
            <th className="text-center p-3 border-b border-fd-border">
              <div className="flex items-center justify-center gap-2">
                <Icons.Room />
                Room
              </div>
            </th>
            <th className="text-center p-3 border-b border-fd-border">
              <div className="flex items-center justify-center gap-2">
                <Icons.Shot />
                Shot
              </div>
            </th>
            <th className="text-center p-3 border-b border-fd-border">
              <div className="flex items-center justify-center gap-2">
                <Icons.Codex />
                Codex
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {features.map((row, index) => (
            <tr key={index} className="border-b border-fd-border last:border-b-0">
              <td className="p-3 font-medium">{row.feature}</td>
              <td className="p-3 text-center text-lg">{row.hero}</td>
              <td className="p-3 text-center text-lg">{row.room}</td>
              <td className="p-3 text-center text-lg">{row.shot}</td>
              <td className="p-3 text-center text-lg">{row.codex}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Usage example callout
export function UsageExample({ 
  title, 
  description, 
  code, 
  components 
}: {
  title: string;
  description: string;
  code: string;
  components: string[];
}) {
  return (
    <div className="border border-fd-border rounded-lg p-6">
      <div className="flex items-start gap-4 mb-4">
        <div className="flex -space-x-2">
          {components.map((component, index) => {
            const IconComponent = Icons[component as keyof typeof Icons];
            return IconComponent ? <IconComponent key={index} /> : null;
          })}
        </div>
        <div>
          <h4 className="font-semibold">{title}</h4>
          <p className="text-sm text-fd-muted-foreground">{description}</p>
        </div>
      </div>
      
      <pre className="bg-fd-muted/50 p-4 rounded-lg text-sm overflow-x-auto">
        <code>{code}</code>
      </pre>
    </div>
  );
}