import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 8191,
    strictPort: true,
  },
  preview: {
    port: 8192,
    strictPort: true,
  },
});
