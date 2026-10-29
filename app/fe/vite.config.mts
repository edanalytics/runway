import { resolve } from 'node:path';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig, type Plugin } from 'vite';

// Vite doesn't fail on a require() in a dependency that it can't resolve: it leaves it as a bare
// import, so the build passes but the app won't load (as with @prisma/client's browser entry).
// Everything the browser loads must be bundled, so fail the build on any import left outside it.
function noUnbundledImports(): Plugin {
  return {
    name: 'no-unbundled-imports',
    apply: 'build',
    generateBundle(_, bundle) {
      const unbundled = new Set(
        Object.values(bundle).flatMap((file) =>
          file.type === 'chunk'
            ? [...file.imports, ...file.dynamicImports].filter((i) => !(i in bundle))
            : []
        )
      );
      if (unbundled.size) {
        const imports = [...unbundled].join(', ');
        this.error(`imports left out of the bundle, which the browser can't load: ${imports}`);
      }
    },
  };
}

export default defineConfig({
  root: __dirname,
  cacheDir: '../node_modules/.vite/fe',

  server: {
    port: 4200,
    host: 'localhost',
  },

  preview: {
    port: 4300,
    host: 'localhost',
  },

  plugins: [
    TanStackRouterVite({
      routesDirectory: resolve(__dirname, './src/app/routes/'), // absolute paths are a workaround for the issue fixed in https://github.com/TanStack/router/pull/5963
      generatedRouteTree: resolve(__dirname, './src/app/routeTree.gen.ts'),
    }),
    react(),
    nxViteTsPaths(),
    visualizer(),
    noUnbundledImports(),
  ],

  // Uncomment this if you are using workers.
  // worker: {
  //  plugins: [ nxViteTsPaths() ],
  // },

  build: {
    outDir: '../dist/fe',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
});
