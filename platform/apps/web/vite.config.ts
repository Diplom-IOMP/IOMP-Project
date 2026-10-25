import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the SPA calls the NestJS API through this proxy; in production
// the built static files are served next to the API, so the UI uses relative URLs.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
      '/livez': 'http://localhost:8080',
      '/readyz': 'http://localhost:8080',
    },
  },
});
