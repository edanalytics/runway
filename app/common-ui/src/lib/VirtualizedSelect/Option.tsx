import { Box } from '@chakra-ui/layout';
import type { SystemStyleObject } from '@chakra-ui/system';
import { useMultiStyleConfig } from '@chakra-ui/system';
import React from 'react';
import type { GroupBase } from 'react-select';
import { useSize } from './utils';
import { MenuIcon, useColorModeValue, Text } from '@chakra-ui/react';
import { OptionProps, ThemeObject } from 'chakra-react-select';
import { CheckIcon } from './CheckIcon';

export const Option = <Option, IsMulti extends boolean, Group extends GroupBase<Option>>(
  props: OptionProps<Option, IsMulti, Group>
) => {
  const {
    className,
    cx,
    innerRef,
    innerProps,
    children,
    isFocused,
    isDisabled,
    isSelected,
    selectProps: {
      chakraStyles,
      size: sizeProp,
      isMulti,
      hideSelectedOptions,
      selectedOptionStyle,
      selectedOptionColorScheme,
    },
  } = props;

  const size = useSize(sizeProp);

  const menuItemStyles: ThemeObject = useMultiStyleConfig('Menu').item;

  const paddings = {
    sm: '0.3rem 0.6rem',
    md: '0.4rem 0.8rem',
    lg: '0.5rem 1rem',
  };

  /**
   * Use the same selected color as the border of the select component
   *
   * @see {@link https://github.com/chakra-ui/chakra-ui/blob/13c6d2e08b61e179773be4722bb81173dd599306/packages/theme/src/components/input.ts#L73}
   */
  const selectedBg = useColorModeValue(
    `${selectedOptionColorScheme}.500`,
    `${selectedOptionColorScheme}.300`
  );
  const selectedColor = useColorModeValue('white', 'black');

  // Don't create exta space for the checkmark if using a multi select with
  // options that dissapear when they're selected
  const showCheckIcon: boolean =
    selectedOptionStyle === 'check' && (!isMulti || hideSelectedOptions === false);

  const shouldHighlight: boolean = selectedOptionStyle === 'color' && isSelected;

  const initialSx: SystemStyleObject = {
    ...menuItemStyles,
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    textAlign: 'start',
    fontSize: size,
    padding: paddings[size],
    ...(isFocused && menuItemStyles._focus),
    ...(shouldHighlight && {
      bg: selectedBg,
      color: selectedColor,
      _active: { bg: selectedBg },
    }),
    ...(isDisabled && menuItemStyles._disabled),
    ...(isDisabled && { _active: {} }),
  };

  const sx = chakraStyles?.option ? chakraStyles.option(initialSx, props) : initialSx;

  return (
    <Box
      {...innerProps}
      role="button"
      className={cx(
        {
          option: true,
          'option--is-disabled': isDisabled,
          'option--is-focused': isFocused,
          'option--is-selected': isSelected,
        },
        className
      )}
      sx={sx}
      ref={innerRef}
      data-disabled={isDisabled ? true : undefined}
      aria-disabled={isDisabled ? true : undefined}
    >
      {showCheckIcon && (
        <MenuIcon fontSize="0.8em" marginEnd="0.75rem" opacity={isSelected ? 1 : 0}>
          <CheckIcon />
        </MenuIcon>
      )}
      {children}
      {(props.data as any).subLabel ? (
        <Text flexGrow={1} textAlign="right" ml="1em" fontSize="sm" color="gray.400">
          {(props.data as any).subLabel}
        </Text>
      ) : null}
    </Box>
  );
};
