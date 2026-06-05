import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev proxy: the FastAPI backend has NO CORS by design, and the session cookie
// is HttpOnly + same-origin. Vite dev runs on :5173, so we proxy /api to the
// backend to make it same-origin from the browser's point of view.
// Override the target with VITE_API_PROXY when the backend lives elsewhere.
const apiProxyTarget = process.env.VITE_API_PROXY || "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    // Kept minimal for now (just jest-dom). Task D1 extends this with MSW
    // and a renderWithProviders helper.
    setupFiles: ["./tests/setup.js"],
  },
});
