import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Le front (npm run dev, port 5173) parle à l'API FastAPI (uvicorn, port 8000)
// via un proxy : côté React on fait fetch("/api/...") sans se soucier du CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
});
