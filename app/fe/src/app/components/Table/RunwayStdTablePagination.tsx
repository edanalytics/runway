import { ChakraComponent } from '@chakra-ui/react';
import { StdTablePagination } from '@edanalytics/common-ui';

export const RunwayStdTablePagination: ChakraComponent<typeof StdTablePagination> = (props) => {
  const { sx, ...rest } = props;

  return (
    <StdTablePagination
      sx={{
        button: {
          color: 'blue.50',
          borderColor: 'blue.50-40',
          backgroundColor: 'blue.700',
          '&:not(:disabled):hover': {
            color: 'blue.700',
            borderColor: 'blue.700',
          },
        },
        select: {
          color: 'blue.50',
          borderColor: 'blue.50-40',
          borderRadius: '4px',
          backgroundColor: 'blue.700',
        },
        option: {
          color: 'blue.700',
        },
        ...sx,
      }}
      {...rest}
    />
  );
};
