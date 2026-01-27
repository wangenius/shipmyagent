import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          <img
            src="/icon-black.svg"
            width={24}
            height={24}
            alt="icon"
            className="w-8 h-8"
          />
          <span className="font-bold">vibecape docs</span>
        </>
      ),
    },
    links: [],
  };
}
