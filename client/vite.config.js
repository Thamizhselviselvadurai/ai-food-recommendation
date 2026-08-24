import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // 127.0.0.1 rather than "localhost": on Windows, Node resolves "localhost" to
  // ::1 first, and the API listens on both stacks — but pinning the proxy to
  // IPv4 avoids a needless failed connect attempt on every proxied request.
  const apiTarget = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:5000';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      /**
       * Bind dual-stack. Vite's default ("localhost") listens on ::1 ONLY, so
       * http://127.0.0.1:5173 was refused outright and any browser or tool that
       * resolves localhost to IPv4 first could not open the app at all.
       * Listening on :: accepts both ::1 and 127.0.0.1.
       */
      host: '::',
      // Dev proxy so the browser only ever talks to one origin — no CORS
      // surprises and no API base URL baked into the bundle.
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: mode !== 'production',
    },
  };
});
