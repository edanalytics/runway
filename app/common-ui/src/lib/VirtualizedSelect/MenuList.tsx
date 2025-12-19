import { Box } from '@chakra-ui/layout';
import type { SystemStyleObject } from '@chakra-ui/system';
import { useMultiStyleConfig } from '@chakra-ui/system';
import { useVirtualizer } from '@tanstack/react-virtual';
import React, { useRef } from 'react';
import type { GroupBase, MenuListProps } from 'react-select';
import { useSize } from './utils';
import { MenuItem } from './MenuItem';

export const MenuList = <Option, IsMulti extends boolean, Group extends GroupBase<Option>>(
  props: MenuListProps<Option, IsMulti, Group> & any
) => {
  const {
    className,
    cx,
    innerRef,
    children,
    maxHeight,
    isMulti,
    innerProps,
    selectProps: { chakraStyles, size: sizeProp, variant, focusBorderColor, errorBorderColor },
  } = props;

  const menuStyles = useMultiStyleConfig('Menu');

  // We're pulling in the border radius from the theme for the input component
  // so we can match the menu lists' border radius to it, but in 2.8.0 the value
  // was changed to being pulled from a theme variable instead of being hardcoded
  const size = useSize(sizeProp);
  const inputStyles = useMultiStyleConfig('Input', {
    size,
    variant,
    focusBorderColor,
    errorBorderColor,
  });
  const fieldStyles = inputStyles.field as Record<string, string>;

  const initialSx: SystemStyleObject = {
    ...menuStyles.list,
    minW: '100%',
    maxHeight: `${maxHeight}px`,
    overflowY: 'auto',
    // This is hacky, but it works. May be removed in the future
    '--input-border-radius': fieldStyles?.['--input-border-radius'],
    borderRadius: fieldStyles?.borderRadius || menuStyles.list?.borderRadius,
    position: 'relative',
    WebkitOverflowScrolling: 'touch',
  };

  const sx = chakraStyles?.menuList ? chakraStyles.menuList(initialSx, props) : initialSx;

  const childrenArr = React.Children.toArray(children);
  const scrollRef: any = useRef<HTMLDivElement>();

  const virtualizer = useVirtualizer({
    count: childrenArr.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 35,
  });

  return (
    <Box
      {...innerProps}
      className={cx(
        {
          'menu-list': true,
          'menu-list--is-multi': isMulti,
        },
        className
      )}
      sx={sx}
      ref={(el) => {
        innerRef && innerRef(el);
        scrollRef.current = el;
      }}
    >
      <Box height={`${virtualizer.getTotalSize()}px`} w="100%" position="relative">
        {virtualizer.getVirtualItems().map((vItem) => {
          const El = childrenArr[vItem.index];
          return (
            <MenuItem
              measureElement={virtualizer.measureElement}
              virtualItem={vItem}
              key={vItem.index}
            >
              {El}
            </MenuItem>
          );
        })}
      </Box>
    </Box>
  );
};
