import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Logic tests run in plain node; anything that renders a component asks for
// the jsdom environment with a docblock comment at the top of the file.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    environment: 'node',
    globals: false,
    // jsdom refuses localStorage on an opaque origin, and the Site Log reads
    // it on mount, so component tests need a real URL to run against.
    environmentOptions: { jsdom: { url: 'http://localhost:3000' } },
    setupFiles: ['./vitest.setup.ts'],
  },
});
