import { StdTable } from '@edanalytics/common-ui';
import { Box, ChakraComponent, SystemStyleObject } from '@chakra-ui/react';

export const runwayTableSx: SystemStyleObject = {
  borderCollapse: 'separate', // only respected if passed via sx
  borderSpacing: '0px',
  th: {
    borderBottom: '1px solid',
    borderColor: 'blue.50-40',
    padding: '300',
    color: 'blue.50',
    fontSize: '0.875rem',
    fontWeight: '600',
    letterSpacing: '0.02em',
    textTransform: 'none',
  },
  td: {
    padding: '300',
    color: 'blue.50',
    borderTop: '1px solid',
    borderColor: 'transparent',
  },
  thead: {
    // thead and tbody can't be separated using margin. We need a little space so the row
    // highlight on hover, which has rounded corners doesn't butt right up against the bottom
    // of the header, which looks funny. Note that the border-spacing also doesn't do quite
    // what we want since this should apply to the thead/tbody spacing rather than spacing
    // among the cells
    '&::after': {
      content: '""',
      display: 'block',
      width: '100%',
      height: '8px',
      backgroundColor: 'transparent',
    },
  },
  tbody: {
    tr: {
      transition: 'background-color 120ms ease',
      _hover: {
        bg: 'blue.600',
        '& td:first-of-type': {
          borderLeftRadius: '4px',
        },
        '& td:last-of-type': {
          borderRightRadius: '4px',
        },
      },
    },
  },
};

export const RunwayStdTable: ChakraComponent<typeof StdTable> = (props) => {
  const { sx, ...rest } = props;
  return (
    <Box
      overflow="auto"
      maxWidth="calc(100vw - 320px)" // full screen minus room for side nav
      layerStyle="contentBox"
    >
      <StdTable
        padding="300"
        sx={{
          ...runwayTableSx,
          ...sx,
        }}
        {...rest}
      />
    </Box>
  );
};
