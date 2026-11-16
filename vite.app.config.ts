// The MCP App: ui/ as one self-contained HTML file (ui/dist/index.html) that mcp/ serves as ui://zenread/app.
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

export default defineConfig({
  define: { __VERSION__: JSON.stringify(version) },
  root: 'ui',
  plugins: [svelte({ preprocess: vitePreprocess() }), viteSingleFile()],
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', sourcemap: false },
});
