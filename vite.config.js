import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [],
  base: './',
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
  },
});
