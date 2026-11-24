import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

// Served from https://cylfox.github.io/trio-game/ (GitHub Pages project site).
export default defineConfig({
  base: '/trio-game/',
  plugins: [tailwindcss(), svelte()],
  // Only index.html is an entry. Without this, Vite's dependency scan would also crawl the
  // Angular apps' HTML under legacy/.
  optimizeDeps: { entries: ['index.html'] },
  // IPv4 loopback, so both http://localhost:PORT and http://127.0.0.1:PORT work: two origins with
  // separate localStorage, i.e. two players on one machine. Pass --host to expose it on the LAN.
  server: { host: '127.0.0.1', watch: { ignored: ['**/legacy/**'] } },
  preview: { host: '127.0.0.1' },
  build: { target: 'es2022' },
});
