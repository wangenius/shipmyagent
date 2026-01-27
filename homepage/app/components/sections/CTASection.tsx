import type { FC } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";

const GITHUB_URL = "https://github.com/wangenius/ShipMyAgent";

export const CTASection: FC = () => {
  return (
    <section className="py-24 md:py-32 lg:py-40 bg-[#fff] relative">
      {/* Thick horizontal rule */}
      <div className="h-1 bg-[#000]" />

      <div className="mx-auto w-full max-w-6xl px-6 md:px-8 lg:px-12 pt-24 md:pt-32">
        <div className="grid grid-cols-12 gap-8">
          {/* Content */}
          <div className="col-span-12 lg:col-span-8">
            {/* Decorative element */}
            <div className="flex items-center gap-4 mb-12">
              <div className="h-2 w-16 md:w-24 bg-[#000]" />
              <div className="size-3 border-2 border-[#000]" />
            </div>

            <h2 className="text-5xl md:text-6xl lg:text-8xl font-normal leading-[0.85] text-[#000] mb-8">
              Ship Your
              <br />
              <span className="italic">Repo</span>
            </h2>

            <p className="text-lg md:text-xl text-[#525252] mb-12 max-w-lg leading-relaxed">
              Transform any GitHub repository into an AI agent. Open source,
              self-hostable, and developer-friendly.
            </p>

            <div className="flex flex-col sm:flex-row items-start gap-4 mb-12">
              <Button asChild>
                <Link
                  to={GITHUB_URL}
                  target="_blank"
                >
                  Get Started
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/docs">
                  Read the Docs
                </Link>
              </Button>
            </div>

            {/* Platform availability */}
            <div className="text-xs uppercase tracking-[0.2em] text-[#525252]">
              <span className="text-[#000]">Open Source</span> on GitHub
              <span className="mx-3">·</span>
              Self-hostable
            </div>
          </div>

          {/* Decorative vertical element */}
          <div className="hidden lg:flex col-span-4 items-end justify-end">
            <div className="w-px h-64 bg-[#000]" />
          </div>
        </div>
      </div>
    </section>
  );
};

export default CTASection;
