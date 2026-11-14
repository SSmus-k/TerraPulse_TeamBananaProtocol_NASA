import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Python API (python -m terrapulse serve) for Excel parsing and model training
    proxy: { "/api": { target: "http://127.0.0.1:8000", changeOrigin: true } },
  },
  build: { chunkSizeWarningLimit: 2500 },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
} as never);
