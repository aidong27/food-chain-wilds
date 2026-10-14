import { defineConfig } from 'vite';
export default defineConfig(({ mode }) => {
  const pages = mode === 'pages';
  return {
    base: pages ? '/food-chain-wilds/' : '/',
    build: { outDir: pages ? 'dist-pages' : 'dist' },
    define: {
      'import.meta.env.VITE_BACKEND_ORIGIN': JSON.stringify(pages ? 'https://food-chain-wilds.food-chain-game.workers.dev' : ''),
    },
    server: { proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } },
  };
});
