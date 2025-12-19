import { extendTheme } from '@chakra-ui/react';
import { theme as base } from '@edanalytics/common-ui';
import { formThemes } from './formThemes';
import { tableThemes } from './tableThemes';

// Importing fonts here since the question "which fonts/font-weights are available?"
// is sort of a theme question and it's maybe easier to remember to define textStyles
// using supported font weights if they're listed up here
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/ibm-plex-sans-condensed/400.css';
import '@fontsource/ibm-plex-sans-condensed/600.css';
import '@fontsource/ibm-plex-sans-condensed/700.css';
import '@fontsource/ibm-plex-serif/400.css';

export const theme = extendTheme({
  ...base,
  fonts: {
    ...base.fonts,
    body: 'Frederik, sans-serif',
    heading: 'Frederik, sans-serif',
  },
  colors: {
    blue: {
      '50-40': '#ECFBFF66', // 40% opacity of blue.50, if on v3 chakra could use alpha or blue.50/40
      50: '#ECFBFF',
      100: '#AAEDFF',
      200: '#4DC6E7',
      300: '#0094C5',
      400: '#2C79AB',
      500: '#2070AD',
      600: '#1E5DA5',
      700: '#004364',
      800: '#052737',
    },
    green: {
      50: '#DEFFFA',
      100: '#87E9DA',
      300: '#36BBA6',
      400: '#007979',
      600: '#004B4B',
      800: '#003333',
    },
    progressGreen: {
      500: '#87E9DA', // progress bar uses .500
    },
    pink: {
      50: '#FEF2FF',
      100: '#CFB2D1',
      300: '#A972AE',
      400: '#88428F',
    },
    purple: {
      50: '#F3F6FF',
      200: '#D3DDFC',
      400: '#7589C5',
      600: '#3751A2',
      700: '#0B236B',
    },
  },
  space: {
    100: '0.25rem',
    200: '0.5rem',
    300: '1rem',
    400: '1.25rem',
    500: '3rem',
    700: '5rem',
    800: '10rem',
  },
  layerStyles: {
    buttonPrimary: {
      borderRadius: '8px',
      bg: 'green.100',
      textColor: 'green.600',
      _hover: {
        bg: 'green.50',
      },
    },
    blueOutline: {
      border: '4px solid',
      borderColor: 'blue.500',
      borderRadius: '8px',
      background: 'blue.600',
    },
    contentBox: {
      backgroundColor: 'blue.700',
      borderRadius: '8px',
      borderWidth: '0px',
      borderColor: 'blue.50-40',
      boxShadow: '0px 0px 2px 0px #ECFBFF',
    },
  },
  textStyles: {
    h1: {
      fontSize: '3.5rem',
      fontWeight: '600',
      lineHeight: '4rem',
    },
    h2: {
      fontSize: '2.5rem',
      fontWeight: '600',
      lineHeight: '2.75rem',
    },
    h3: {
      fontSize: '2rem',
      fontWeight: '600',
      lineHeight: '2.5rem',
    },
    h4: {
      fontSize: '1.75rem',
      fontWeight: '600',
      lineHeight: '2rem',
    },
    h5: {
      fontSize: '1.5rem',
      fontWeight: '600',
      lineHeight: '1.75rem',
    },
    h6: {
      fontSize: '0.875rem',
      fontWeight: '600',
      lineHeight: '1rem',
    },
    body: {
      fontFamily: 'IBM Plex Sans Condensed, sans-serif',
      fontSize: '1rem',
      fontWeight: '400',
      lineHeight: '20px',
    },
    bodyLarge: {
      fontFamily: 'IBM Plex Sans Condensed, sans-serif',
      fontSize: '1.25rem',
      fontWeight: '400',
      lineHeight: '28px',
    },
    bodyBold: {
      fontFamily: 'IBM Plex Sans Condensed, sans-serif',
      fontSize: '1rem',
      fontWeight: '700',
      lineHeight: '20px',
    },
    bodyLargeBold: {
      fontFamily: 'IBM Plex Sans Condensed, sans-serif',
      fontSize: '1.25rem',
      fontWeight: '700',
      lineHeight: '24px',
    },
    button: {
      fontSize: '1rem',
      fontWeight: '600',
      lineHeight: '1.25rem',
    },
    accent: {
      fontFamily: 'IBM Plex Serif, serif',
      fontWeight: '400',
      fontStyle: 'italic',
      fontSize: '1.125rem',
      lineHeight: '1.5rem',
    },
  },
  components: {
    Form: formThemes.FormControl,
    FormLabel: formThemes.FormLabel,
    Input: formThemes.Input,
    FormError: formThemes.FormError,
    Table: tableThemes.Table,
  },
});
