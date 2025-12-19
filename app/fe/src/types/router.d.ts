import { router } from './app';

// Register the type of our own router to the global level.
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
