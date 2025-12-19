import {
  Button,
  ChakraComponent,
  Icon,
  IconButton,
  InputGroup,
  InputLeftElement,
  InputRightElement,
} from '@chakra-ui/react';
import { BiSearch } from 'react-icons/bi';
import { BsX } from 'react-icons/bs';
import { DebouncedInput, DivComponent, useStdTableContext } from '..';

export const StdTableSearch: ChakraComponent<'div', { debounce?: number }> = (props) => {
  const { children, ...rest } = props;
  const {
    table,
    showSettings: [showSettings, setShowSettings],
  } = useStdTableContext();

  if (!table) {
    return null as any;
  }
  const { globalFilter } = table.getState();
  const { setGlobalFilter } = table;

  return (
    <InputGroup
      css={{
        '&:hover .clear-filter': {
          color: 'var(--chakra-colors-gray-800)',
          transition: '0.3s',
        },
      }}
      maxW="30em"
      {...rest}
    >
      <InputLeftElement pointerEvents="none" color="gray.300">
        <Icon fontSize="1.2em" as={BiSearch} />
      </InputLeftElement>
      <DebouncedInput
        debounce={props.debounce ?? 300}
        borderRadius="100em"
        paddingStart={10}
        paddingEnd={10}
        placeholder="Search"
        value={globalFilter ?? ''}
        onChange={(v) => setGlobalFilter(v)}
      />
      {globalFilter ? (
        <InputRightElement>
          <IconButton
            onClick={() => setGlobalFilter(undefined)}
            className="clear-filter"
            fontSize="xl"
            color="gray.300"
            variant="ghost"
            size="sm"
            borderRadius={'100em'}
            icon={<Icon as={BsX} />}
            aria-label="clear search"
          />
        </InputRightElement>
      ) : null}
    </InputGroup>
  );
};

export const StdTableAdvancedButton: ChakraComponent<'button'> = (props) => {
  const { children, onClick, ...rest } = props;
  const {
    table,
    showSettings: [showSettings, setShowSettings],
  } = useStdTableContext();

  if (!table) {
    return null as any;
  }

  return (
    <Button
      alignSelf="center"
      aria-label="show settings"
      variant="link"
      borderRadius="99em"
      size="sm"
      colorScheme="teal"
      onClick={setShowSettings.toggle}
      {...rest}
    >
      {showSettings ? 'Hide options' : 'More options'}
    </Button>
  );
};
