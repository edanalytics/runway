import { useRouterState } from '@tanstack/react-router';
import { useMemo } from 'react';

/** In principle the route `meta` is meant for any kind of HTML meta tag, but we're only using it for the page title. */
export const Metas = () => {
  const routeMeta = useRouterState({
    select: (state) => {
      return state.matches.map((match) => match.meta!).filter(Boolean);
    },
  });

  const title = useMemo(() => {
    let title: { title: string } | undefined;
    for (let i = routeMeta.length - 1; i >= 0; i--) {
      const metas = [...routeMeta][i];

      // eslint-ignore-next-line no-loop-func
      [...metas].reverse().forEach((m) => {
        if (m.title) {
          if (!title) {
            title = { title: m.title }; // ! The page title (visible as the name of the tab and the history entry) comes from route meta. Be sure to follow the pattern.
          }
        }
      });
      if (title) break;
    }
    return title;
  }, [routeMeta]);

  return title ? <title>Runway{title.title ? ` - ${title.title}` : ''}</title> : null;
};
