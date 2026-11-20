import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  esbuild: { jsx: "automatic" },
  oxc: { jsx: { runtime: "automatic" } },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }, dedupe: ['react', 'react-dom'] },
  test: { environment: 'jsdom', include: ['tests/**/*.test.tsx'] },
});
