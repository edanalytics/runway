import 'reflect-metadata';
import { theme } from '../src/lib/theme';
import type { Preview } from '@storybook/react';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';

const preview: Preview = {
  parameters: {
    chakra: {
      theme,
    },
  },
  decorators: [
    (Story) => {
      return (
        <RouterProvider
          router={createRouter({
            history: createMemoryHistory(),
            routeTree: createRootRoute({
              component: Story,
            }),
          })}
        />
      );
    },
  ],
};

export default preview;
