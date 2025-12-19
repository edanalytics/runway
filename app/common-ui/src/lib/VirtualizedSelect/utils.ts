import { useBreakpointValue } from '@chakra-ui/media-query';
import type { ResponsiveObject } from '@chakra-ui/system';
import { useTheme } from '@chakra-ui/system';

export type Size = 'sm' | 'md' | 'lg';
export type SizeProp = Size | ResponsiveObject<Size> | Size[];

/** A typeguard to ensure the default size on the Input component is valid. */
const isSize = (size: unknown): size is Size => {
  const isString = typeof size === 'string';
  return isString && ['sm', 'md', 'lg'].includes(size);
};

const getDefaultSize = (size: unknown): Size => {
  if (isSize(size)) {
    return size;
  }

  if (size === 'xs') {
    return 'sm';
  }

  // This shouldn't be necessary but it might help the size get closer to the
  // user's goal if they have `xl` as a custom size.
  if (size === 'xl') {
    return 'lg';
  }

  return 'md';
};

export const useSize = (size: SizeProp | undefined): Size => {
  const chakraTheme = useTheme();
  const defaultSize = getDefaultSize(chakraTheme.components.Input.defaultProps.size);

  // Ensure that the size used is one of the options, either `sm`, `md`, or `lg`
  const definedSize: SizeProp = size ?? defaultSize;
  // Or, if a breakpoint is passed, get the size based on the current screen size
  const realSize: Size =
    useBreakpointValue<Size>(typeof definedSize === 'string' ? [definedSize] : definedSize, {
      fallback: 'md',
    }) || defaultSize;

  return realSize;
};
