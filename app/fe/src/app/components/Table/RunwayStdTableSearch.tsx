import {
  ChakraComponent,
  InputGroup,
  InputLeftElement,
  InputRightElement,
  IconButton,
  Icon,
} from '@chakra-ui/react';
import { DebouncedInput, useStdTableContext } from '@edanalytics/common-ui';
import { BiSearch } from 'react-icons/bi';
import { BsX } from 'react-icons/bs';

// This is a copy of StdTableSearch, adapted to Runway styles
export const RunwayStdTableSearch: ChakraComponent<'div', { debounce?: number }> = (props) => {
  const { children, sx, ...rest } = props;
  const { table } = useStdTableContext();

  if (!table) {
    return null as any;
  }
  const { globalFilter } = table.getState();
  const { setGlobalFilter } = table;

  return (
    <InputGroup
      maxW="30em"
      sx={{
        '&:hover .clear-filter': {
          color: 'blue.50',
          transition: '0.3s',
        },
        ...sx,
      }}
      {...rest}
    >
      <InputLeftElement pointerEvents="none" padding="200">
        <Icon fontSize="xl" as={BiSearch} color="blue.50-40" />
      </InputLeftElement>
      <DebouncedInput
        debounce={props.debounce ?? 300}
        borderRadius="100em"
        borderColor="blue.50-40"
        _focus={{
          borderColor: 'blue.50-40', // TODO: this overrides defaults from formThemes... we should better encapsulate those defaults (e.g. in a variant)
        }}
        _hover={{
          borderColor: 'blue.50-40',
        }}
        color="blue.50"
        backgroundColor="blue.700"
        paddingY="200"
        paddingLeft="2.5rem"
        paddingRight={10}
        placeholder="Search"
        _placeholder={{ color: 'blue.50-40' }}
        value={globalFilter ?? ''}
        onChange={(v) => setGlobalFilter(v)}
      />
      {globalFilter ? (
        <InputRightElement padding="200">
          <IconButton
            onClick={() => setGlobalFilter(undefined)}
            className="clear-filter"
            fontSize="xl"
            color="blue.50-40"
            _hover={{
              color: 'blue.50',
              backgroundColor: 'blue.50-40',
            }}
            variant="ghost"
            size="sm"
            margin="-5px"
            borderRadius="100em"
            icon={<Icon as={BsX} />}
            aria-label="clear search"
          />
        </InputRightElement>
      ) : null}
    </InputGroup>
  );
};
