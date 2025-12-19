import { Badge, Box, Link, Text } from '@chakra-ui/react';
import { SearchWithResults } from './SearchWithResults';
import { useState } from 'react';
import { faker } from '@faker-js/faker';

export default {
  title: 'SearchWithResults',
  component: SearchWithResults,
};

const data = Object.values(
  Object.fromEntries(
    Array.from({ length: 500 }, () => faker.science.chemicalElement()).map((element) => [
      element.symbol,
      element,
    ])
  )
);
const ChemElement = (props: {
  element: { symbol: string; name: string; atomicNumber: number };
}) => (
  <Text px={4} _hover={{ bg: 'gray.50' }}>
    <Badge display="inline-block" textAlign="center" w="2em" mr="2em">
      {props.element.symbol}
    </Badge>
    <Link display="inline-block" w="8em">
      {props.element.name}
    </Link>
    <i>{props.element.atomicNumber}</i>
  </Text>
);

export const Standard = () => {
  const [state, _setState] = useState<string>('');
  const setState = (value: string | undefined) => {
    _setState(value === undefined ? '' : value);
  };
  return (
    <Box w="15em">
      <SearchWithResults
        openWidth="25em"
        items={
          <>
            {data
              .filter((element) => state && element.name.includes(state))
              .map((element) => (
                <ChemElement key={element.symbol} element={element} />
              ))}
          </>
        }
        onChange={setState}
        value={state}
      />
      <p>Hello wold</p>
      <p>Hello wold</p>
      <p>Hello wold</p>
      <p>Hello wold</p>
      <p>Hello wold</p>
      <p>Hello wold</p>
      <p>Hello wold</p>
      <p>Hello wold</p>
      <p>Hello wold</p>
      <p>Hello wold</p>
      <p>Hello wold</p>
      <p>Hello wold</p>
      <p>Hello wold</p>
      <p>Hello wold</p>
      <p>Hello wold</p>
      <p>Hello wold</p>
    </Box>
  );
};
