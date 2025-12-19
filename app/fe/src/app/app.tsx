import 'reflect-metadata';

import { Button, ChakraProvider } from '@chakra-ui/react';
import { NotificationBannerProvider } from '@edanalytics/common-ui';
import { QueryClient, QueryClientProvider, QueryErrorResetBoundary } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/router-devtools';
import { Suspense } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { routeTree } from './routeTree.gen';
import { theme } from './theme';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: false,
    },
  },
});

export const router = createRouter({
  defaultPreload: 'intent',
  defaultPreloadDelay: 100,
  routeTree,
  context: {
    queryClient,
    hideSideNav: false,
  },
});
export const Routes = () => {
  return (
    <>
      <RouterProvider router={router} />
      {/* 
        TODO: re-enable router devtools when I've got a better handle on why they're showing up 
        inappropriately in non-dev environments. They should be suppressed (as the query dev tools are)
        based on NODE_ENV in the build environment. Not clear right now whether upgrading will fix this 
        or we need to do something with NODE_ENV, so commenting it out for now rather than applying an 
        inline conditional... which is more like a hack that'll hang around longer than it should.
       */}
      {/* <TanStackRouterDevtools position="bottom-right" router={router} /> */}
    </>
  );
};

function App() {
  return (
    <NotificationBannerProvider>
      <ChakraProvider theme={theme}>
        <QueryClientProvider client={queryClient}>
          <QueryErrorResetBoundary>
            {({ reset }) => (
              <ErrorBoundary
                fallbackRender={({ error, resetErrorBoundary }) => (
                  <>
                    <Button onClick={() => resetErrorBoundary()}>Try again</Button>
                    <pre style={{ whiteSpace: 'normal' }}>{error.message}</pre>
                  </>
                )}
                onReset={reset}
              >
                <Suspense fallback={<>loading...</>}>
                  <Routes />
                  <ReactQueryDevtools
                    initialIsOpen={false}
                    position="bottom"
                    buttonPosition="bottom-left"
                  />
                </Suspense>
              </ErrorBoundary>
            )}
          </QueryErrorResetBoundary>
        </QueryClientProvider>
      </ChakraProvider>
    </NotificationBannerProvider>
  );
}

export default App;
