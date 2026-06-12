import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
