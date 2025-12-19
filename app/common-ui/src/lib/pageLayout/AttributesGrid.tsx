import { SimpleGrid, SimpleGridProps, forwardRef } from '@chakra-ui/react';

export const AttributesGrid = forwardRef<SimpleGridProps, 'div'>((props, ref) => (
  <SimpleGrid m="calc(-1 * var(--chakra-space-3))" columns={2} spacing={0} ref={ref} {...props} />
));
