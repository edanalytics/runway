import { createMultiStyleConfigHelpers, defineStyleConfig } from '@chakra-ui/react';
import { formAnatomy, inputAnatomy, formErrorAnatomy } from '@chakra-ui/anatomy';

/**
 * Styling for Form Components. These are imported into our main app theme.
 * Note that they have dependencies on the main theme, which defines most of
 * the variables used here, so these aren't at all portable.
 */

const noOutline = { boxShadow: 'none', borderColor: 'transparent' };
const pointer = { cursor: 'pointer' };

const formControlHelper = createMultiStyleConfigHelpers(formAnatomy.keys);
const FormControl = formControlHelper.defineMultiStyleConfig({
  baseStyle: {
    container: {
      bg: 'blue.800',
      textColor: 'blue.100',
      borderRadius: '8px',
      padding: '200',
      _focusWithin: {
        boxShadow: `0 0 2px 1px var(--chakra-colors-blue-100)`,
      },
      _hover: {
        boxShadow: `0 0 2px 1px var(--chakra-colors-blue-100)`,
      },
    },
  },
  variants: {
    file: formControlHelper.definePartsStyle({
      container: {
        bg: 'transparent',
        _focusVisible: noOutline,
        _focus: noOutline,
        _hover: { ...noOutline, ...pointer },
      },
    }),
  },
});

const FormLabel = defineStyleConfig({
  baseStyle: {
    textStyle: 'button',
    margin: '0',
  },
  variants: {
    file: {
      _hover: pointer,
    },
  },
});

const formErrorHelpers = createMultiStyleConfigHelpers(formErrorAnatomy.keys);
const FormError = formErrorHelpers.defineMultiStyleConfig({
  baseStyle: formErrorHelpers.definePartsStyle({
    text: {
      textStyle: 'body',
      textColor: 'pink.100',
      mt: '0',
    },
  }),
});

const inputHelpers = createMultiStyleConfigHelpers(inputAnatomy.keys);
const Input = inputHelpers.defineMultiStyleConfig({
  baseStyle: inputHelpers.definePartsStyle({
    // TODO: move to a variant so as not to override input styles elsewhere
    field: {
      textStyle: 'body',
      padding: '0',
      height: 'fit-content', // TODO: add variant for larger inputs
      _focusVisible: noOutline,
      _focus: noOutline,
      _hover: noOutline,
    },
  }),
  variants: {
    outline: inputHelpers.definePartsStyle({
      field: {
        borderColor: 'transparent',

        _invalid: {
          borderTop: '0',
          borderLeft: '0',
          borderRight: '0',
          borderColor: 'pink.300',
          borderRadius: '0',
          boxShadow: 'none',
        },
        _hover: noOutline,
      },
    }),
    file: inputHelpers.definePartsStyle({
      field: {
        _hover: pointer,
      },
    }),
  },
});

export const formThemes = { FormControl, FormLabel, Input, FormError };
