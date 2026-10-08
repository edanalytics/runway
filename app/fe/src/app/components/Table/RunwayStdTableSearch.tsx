import { ChakraComponent } from '@chakra-ui/react';
import { useStdTableContext } from '@edanalytics/common-ui';
import { RunwaySearchInput } from '../RunwaySearchInput';

// This is a copy of StdTableSearch, adapted to Runway styles
export const RunwayStdTableSearch: ChakraComponent<'div', { debounce?: number }> = (props) => {
  const { children, debounce, ...rest } = props;
  const { table } = useStdTableContext();

  if (!table) {
    return null as any;
  }
  const { globalFilter } = table.getState();
  const { setGlobalFilter } = table;

  return (
    <RunwaySearchInput
      {...rest}
      debounce={debounce}
      value={globalFilter}
      onChange={(v) => setGlobalFilter(v)}
    />
  );
};
