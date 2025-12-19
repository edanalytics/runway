# Front-end

The unauthenticated landing page is built by hand with no ChakraUI or other unnecessary tools to save bundle size on the initial load. The production build process is configured with a plugin to generate a bundle analysis on each build. Open `./fe/stats.html` in a browser to see the results.

This app uses @tanstack/react-router's file-based routing, which generates the `routeTree.gen.ts` file (which actually gets run) based on the names and contents of the other route files (which we edit).

See various comments throughout the source files for explanation of particular things.
