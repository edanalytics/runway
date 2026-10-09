import {
  Icon,
  IconButton,
  InputGroup,
  InputGroupProps,
  InputLeftElement,
  InputRightElement,
} from '@chakra-ui/react';
import { DebouncedInput } from '@edanalytics/common-ui';
import { BiSearch } from 'react-icons/bi';
import { BsX } from 'react-icons/bs';

export const RunwaySearchInput = ({
  value,
  onChange,
  debounce = 300,
  placeholder = 'Search',
  sx,
  ...rest
}: Omit<InputGroupProps, 'onChange'> & {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  debounce?: number;
  placeholder?: string;
}) => (
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
      debounce={debounce}
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
      placeholder={placeholder}
      _placeholder={{ color: 'blue.50-40' }}
      value={value ?? ''}
      onChange={(v) => onChange(v)}
    />
    {value ? (
      <InputRightElement padding="200">
        <IconButton
          onClick={() => onChange(undefined)}
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
