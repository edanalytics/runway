import { ButtonGroup as CBG, ButtonGroupProps, forwardRef } from '@chakra-ui/react';
import React from 'react';

export const ButtonGroup = forwardRef<ButtonGroupProps, 'div'>((props, ref) => {
  const { isAttached, spacing = 2 } = props;
  const styles = {
    flexDirection: { base: 'column', lg: 'row' },
    '& > *:not(style) ~ *:not(style)': {
      marginStart: { base: 0, lg: spacing },
      marginTop: { base: 3, lg: 0 },
    },
  };
  if (!isAttached) {
    return <CBG ref={ref} sx={styles} {...props} />;
  }
  return <CBG ref={ref} {...props} />;
});

const inactiveStyles = {
  color: 'gray.700',
  borderColor: 'gray.100',
  bg: 'gray.100',
  _hover: { bg: 'gray.300' },
  _active: { bg: 'gray.200' },
};

/**
 * @example (
 * <ToggleButtonGroup onChange={handleChangeValue} value={value}>
 *  <Button value={value1}>label1</Button>
 *  <Button value={value2}>label2</Button>
 * </ToggleButtonGroup>
 * )
 * @note
 * must have multiple child elements
 */
export const ToggleButtonGroup: React.FC<{
  onChange: (value: string) => void;
  value: string;
  groupProps?: ButtonGroupProps;
  children?: React.ReactNode;
}> = ({ onChange, value, children, groupProps }) => {
  if (!children) throw new Error('Children required');
  // iterate over array of child nodes to apply extended props
  return (
    <ButtonGroup {...groupProps}>
      {React.Children.map(children as React.ReactElement[], (CHILD) => {
        console.log(CHILD?.props?.value, value, CHILD?.props?.value === value);

        return React.cloneElement(CHILD, {
          onClick: () => {
            if (value === CHILD?.props?.value) return;
            onChange(CHILD?.props?.value);
          },
          ...(value !== CHILD?.props?.value ? { sx: inactiveStyles } : { colorScheme: 'teal' }),
        });
      })}
    </ButtonGroup>
  );
};
