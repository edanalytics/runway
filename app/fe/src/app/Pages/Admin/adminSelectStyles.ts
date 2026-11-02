import { ChakraStylesConfig, GroupBase } from 'chakra-react-select';

/**
 * The admin page's selects: light text on the dark control, and a menu that
 * matches RunwaySelect's, dark text on a light menu.
 */
// A function of the option type, given at the call: the Select infers its
// option type from chakraStyles too, so a fixed type would override it.
export const adminSelectStyles = <Option>(): ChakraStylesConfig<
  Option,
  false,
  GroupBase<Option>
> => ({
  control: (baseStyles) => ({ ...baseStyles, bg: 'blue.800', color: 'blue.50' }),
  placeholder: (baseStyles) => ({ ...baseStyles, color: 'blue.50' }),
  dropdownIndicator: (baseStyles) => ({ ...baseStyles, bg: 'transparent', color: 'blue.50' }),
  menu: (baseStyles) => ({
    ...baseStyles,
    textStyle: 'body',
    textColor: 'blue.700',
    bg: 'blue.50',
  }),
  menuList: (baseStyles) => ({ ...baseStyles, border: 'none' }),
  option: (baseStyles) => ({ ...baseStyles, padding: '200' }),
});
