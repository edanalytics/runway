import { Box } from '@chakra-ui/layout';
import type { SystemStyleObject } from '@chakra-ui/system';
import React from 'react';
import type { GroupBase } from 'react-select';
import { Text } from '@chakra-ui/react';
import { SingleValueProps } from 'chakra-react-select';

export const SingleValue = <Option, IsMulti extends boolean, Group extends GroupBase<Option>>(
  props: SingleValueProps<Option, IsMulti, Group>
) => {
  const {
    children,
    className,
    cx,
    isDisabled,
    innerProps,
    selectProps: { chakraStyles },
  } = props;

  const initialSx: SystemStyleObject = {
    gridArea: '1 / 1 / 2 / 3',
    mx: '0.125rem',
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  };

  const sx = chakraStyles?.singleValue ? chakraStyles.singleValue(initialSx, props) : initialSx;

  return (
    <Box
      className={cx(
        {
          'single-value': true,
          'single-value--is-disabled': isDisabled,
        },
        className
      )}
      sx={sx}
      {...innerProps}
    >
      {children}
      {(props.data as any).subLabel ? (
        <Text ml="1em" fontSize="sm" color="gray.400">
          {(props.data as any).subLabel}
        </Text>
      ) : null}
    </Box>
  );
};
