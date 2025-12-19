import {
  Box,
  Divider,
  Icon,
  IconButton,
  InputGroup,
  InputLeftElement,
  InputRightElement,
  Stack,
  chakra,
} from '@chakra-ui/react';
import { BiSearch } from 'react-icons/bi';
import { BsX } from 'react-icons/bs';
import { DebouncedInput } from '../dataTable';

export const SearchWithResults = (props: {
  value: string;
  onChange: (value: string) => void;
  items: JSX.Element;
  openWidth?: string;
}) => {
  return (
    <Box h="2.85em" margin="calc(-0.1em - 1px)" p="0.1em">
      <Box
        shadow="none"
        bg="white"
        border="1px solid"
        borderColor="gray.200"
        borderRadius="lg"
        boxSizing="content-box"
        css={`
          &:has(.focus-container:focus-within) {
            z-index: 1001;
          }
          &:has(.input-group:hover) .clear-filter {
            color: var(--chakra-colors-gray-800);
          }
          &:has(.focus-container:focus-within) {
            width: max(${props.openWidth ?? '0'}, calc(100% - 1.5rem));
            min-width: ${props.openWidth ?? 'unset'};
            margin: -0.1em;
            padding: 0.1em;
            position: absolute;
            box-shadow: var(--chakra-shadows-2xl);
            outline-width: 2px;
            outline-color: var(--chakra-colors-blue-300);
            outline-style: solid;
          }
          &:has(.focus-container:focus-within) .results {
            display: block;
            min-height: 150px;
          }
          &:has(.focus-container:focus-within) .outside-filter {
            display: none;
          }
          &:has(.focus-container:focus-within) .inside-filter {
            display: flex;
          }
          &:has(.focus-container:focus-within) .search-input {
            border-bottom-color: transparent;
            border-bottom-right-radius: 0;
            border-bottom-left-radius: 0;
            box-shadow: none;
          }
        `}
      >
        {props.value !== '' ? (
          <chakra.div className="outside-filter" position="relative" zIndex="dropdown">
            <IconButton
              position="absolute"
              top="0.25em"
              right="0.2em"
              onClick={() => props.onChange('')}
              className="clear-filter"
              fontSize="xl"
              color="gray.300"
              variant="ghost"
              size="sm"
              borderRadius={'100em'}
              icon={<Icon as={BsX} />}
              aria-label="clear search"
            />
          </chakra.div>
        ) : null}

        <Box className="focus-container">
          <InputGroup className="input-group" w="100%">
            <InputLeftElement pointerEvents="none" color="gray.300">
              <Icon fontSize="1.2em" as={BiSearch} />
            </InputLeftElement>
            <DebouncedInput
              debounce={300}
              bg="none"
              outline="none"
              border="none"
              paddingStart={10}
              paddingEnd={10}
              placeholder="Search"
              className="search-input"
              value={props.value ?? ''}
              _focusVisible={{
                outlineColor: 'transparent',
              }}
              onChange={(e) => props.onChange(e ?? '')}
            />
            {props.value !== '' ? (
              <InputRightElement className="inside-filter" display="none" top="1px">
                <IconButton
                  onClick={() => props.onChange('')}
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
          <Stack
            className="results"
            display="none"
            width="100%"
            bg="none"
            zIndex="dropdown"
            overflow="hidden"
          >
            <Divider mb={0} />
            {props.items}
          </Stack>
        </Box>
      </Box>
    </Box>
  );
};
