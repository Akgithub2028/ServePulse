import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The frontend is a static bundle served by Render's static-site runtime. It talks to
// the backend over HTTPS using a URL supplied at BUILD time (VITE_API_BASE_URL), so the
// same source produces a local, staging or production bundle with no code change and no
// hardcoded production URL in the repository.
//
// No dev-server proxy to the backend on purpose: the deployed site is cross-origin by
// construction, so developing against the real CORS configuration locally is the honest
// default. Point VITE_API_BASE_URL at a locally running `python scripts/serve.py`.
export default defineConfig({
  plugins: [react()],
  build: {
    // Split the two heavy views out of the initial bundle: the landing view should not
    // pay for code a visitor may never open.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
        },
      },
    },
    // Fail the build on a broken import rather than shipping a partially-built site.
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // Bind all interfaces so the sandbox/container preview can reach it.
    host: true,
  },
});
