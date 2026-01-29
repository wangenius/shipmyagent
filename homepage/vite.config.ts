import { reactRouter } from "@react-router/dev/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import mdx from "fumadocs-mdx/vite";
import * as MdxConfig from "./source.config";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  base: "/",
  plugins: [tailwindcss(), mdx(MdxConfig), reactRouter(), tsconfigPaths()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./app"),
      "~": path.resolve(__dirname, "."),
      "@/.source": path.resolve(__dirname, "./.source/server"),
    },
  },

});
