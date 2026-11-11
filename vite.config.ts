/// <reference types="vitest/config" />
// Build configuration.
//
// One codebase, two outputs:
//   npm run build        -> dist/                      (many small files; the Tauri desktop app loads these)
//   npm run build:html   -> dist-html/policy-debate.html (ONE self-contained file; works offline from a USB drive)
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';
import { renameSync, existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig(({ mode }) => {
  const single = mode === 'singlefile';
  return {
    plugins: [
      preact(),
      ...(single
        ? [
            viteSingleFile({ removeViteModuleLoader: true }),
            {
              // Give the single file a friendly name instead of index.html.
              name: 'rename-single-file',
              closeBundle() {
                const from = fileURLToPath(new URL('./dist-html/index.html', import.meta.url));
                const to = fileURLToPath(new URL('./dist-html/policy-debate.html', import.meta.url));
                if (existsSync(from)) renameSync(from, to);
              },
            },
          ]
        : []),
    ],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __SINGLE_FILE__: JSON.stringify(single),
    },
    // Tauri expects a fixed dev port and must not have its Rust output watched.
    clearScreen: false,
    server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
    build: {
      outDir: single ? 'dist-html' : 'dist',
      target: 'es2022',
      // WebKit (Linux/macOS desktop) and file:// both dislike lazy chunks, so keep everything together.
      rollupOptions: single ? { output: { inlineDynamicImports: true } } : {},
      chunkSizeWarningLimit: 4000,
    },
    test: {
      environment: 'happy-dom',
      include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
      setupFiles: ['tests/unit/setup.ts'],
    },
  };
});
