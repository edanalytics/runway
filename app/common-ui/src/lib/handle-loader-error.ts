import { notFound } from '@tanstack/react-router';

/**
 * Handle errors in @tanstack/router data loaders. In particular call tsr
 * notFound() to appropriately trigger router's not-found behavior.
 * */
export const handleLoaderError = (err: any) => {
  if (err?.title === 'Not found') {
    throw notFound();
  }
  throw err;
};
