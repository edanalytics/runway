import { Box } from '@chakra-ui/layout';
import { VirtualItem } from '@tanstack/react-virtual';
import React, { ReactNode } from 'react';

export const MenuItem = (props: {
  virtualItem: VirtualItem<Element>;
  measureElement: any;
  children: ReactNode;
}) => {
  return (
    <Box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      transform={`translateY(${props.virtualItem.start}px)`}
      key={props.virtualItem.index}
      ref={props.measureElement}
      data-index={props.virtualItem.index}
    >
      {props.children}
    </Box>
  );
};
