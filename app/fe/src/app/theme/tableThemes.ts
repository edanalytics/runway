import { createMultiStyleConfigHelpers } from '@chakra-ui/react';
import { tableAnatomy } from '@chakra-ui/anatomy';

const tableHelper = createMultiStyleConfigHelpers(tableAnatomy.keys);
const Table = tableHelper.defineMultiStyleConfig({
  defaultProps: {
    // Chakra's built-in default variant will override values set in baseStyle
    // unless you provide an override variant of your own
    // https://github.com/chakra-ui/chakra-ui/issues/7150#issuecomment-1362683213
    variant: 'empty',
  },
  variants: {
    empty: {}, // for overriding the default variant
  },
});

export const tableThemes = {
  Table: Table,
};
