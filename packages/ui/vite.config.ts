import { defineConfig } from "vite";

// @vitejs/plugin-react only adds fast-refresh; esbuild handles the JSX
// transform, so the build still works in environments where the plugin
// isn't installed.
const reactPlugin = await import("@vitejs/plugin-react")
  .then((m) => m.default())
  .catch(() => null);

export default defineConfig({
  plugins: reactPlugin ? [reactPlugin] : [],
  esbuild: { jsx: "automatic" },
  server: {
    port: 5173,
    // forward API calls to the Next.js API (`npm run dev --workspace @looper/api`)
    proxy: {
      "/api": {
        target: process.env.LOOPER_API_ORIGIN ?? "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
