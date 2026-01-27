import type { FC } from "react";

const stats = [
  {
    value: "100%",
    label: "Local Data",
    description: "Your files never leave your machine",
  },
  {
    value: "∞",
    label: "Context Length",
    description: "Unlimited document references",
  },
  {
    value: "10+",
    label: "AI Models",
    description: "OpenAI, Claude, Gemini, and more",
  },
  {
    value: "0",
    label: "Subscriptions",
    description: "Free forever, no hidden costs",
  },
];

export const StatsSection: FC = () => {
  return (
    <section className="py-24 md:py-32 lg:py-40 bg-[#000] text-[#fff] pattern-lines-inverted">
      {/* Thick horizontal rule - inverted */}
      <div className="h-1 bg-[#fff]" />

      <div className="mx-auto w-full max-w-6xl px-6 md:px-8 lg:px-12 pt-24 md:pt-32">
        {/* Section Header */}
        <div className="mb-20 md:mb-28">
          <div className="flex items-center gap-4 mb-6">
            <span className="text-[10px] uppercase tracking-[0.3em] text-[#A3A3A3]">
              By the Numbers
            </span>
            <div className="h-px flex-1 bg-[#333]" />
          </div>
          <h2 className="text-5xl md:text-6xl lg:text-7xl font-normal leading-[0.9] text-[#fff]">
            Built for
            <br />
            <span className="italic">Creators</span>
          </h2>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-0 border-t border-l border-[#fff]">
          {stats.map((stat, i) => (
            <div
              key={i}
              className="group p-8 md:p-10 border-b border-r border-[#fff] hover:bg-[#fff] hover:text-[#000] transition-colors duration-100"
            >
              {/* Value - oversized */}
              <div className="text-5xl md:text-6xl lg:text-7xl font-normal mb-4 group-hover:text-[#000] transition-colors duration-100">
                {stat.value}
              </div>

              {/* Label */}
              <div className="text-sm uppercase tracking-[0.2em] mb-2 text-[#fff] group-hover:text-[#000] transition-colors duration-100">
                {stat.label}
              </div>

              {/* Description */}
              <p className="text-sm text-[#A3A3A3] group-hover:text-[#525252] transition-colors duration-100">
                {stat.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default StatsSection;
