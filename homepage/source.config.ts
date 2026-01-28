import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import {
  remarkImage,
  remarkHeading,
  remarkDirectiveAdmonition,
} from "fumadocs-core/mdx-plugins";
import { remarkMdxMermaid } from "fumadocs-core/mdx-plugins";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import remarkDirective from "remark-directive";

export const docs = defineDocs({
  dir: "content/docs",
});

export default defineConfig({
  mdxOptions: {
    remarkPlugins: (v) => [
      ...v,
      remarkDirective,
      remarkDirectiveAdmonition,
      remarkMath,
      remarkImage,
      remarkHeading,
      remarkMdxMermaid,
    ],
    rehypePlugins: (v) => [[rehypeKatex, { strict: false }], ...v],
    remarkImageOptions: {
      placeholder: "none",
    },
  },
});
