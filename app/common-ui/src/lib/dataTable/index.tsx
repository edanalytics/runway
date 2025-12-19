import { Input, InputProps, forwardRef } from '@chakra-ui/react';
import { ColumnFiltersState, FilterFn, PaginationState, SortingState } from '@tanstack/react-table';
import React from 'react';

import { rankItem } from '@tanstack/match-sorter-utils';

export const fuzzyFilter: FilterFn<any> = (row, columnId, value, addMeta) => {
  // Rank the item
  const itemRank = rankItem(row.getValue(columnId), value);

  // Store the itemRank info
  addMeta({
    itemRank,
  });

  // Return if the item should be filtered in/out
  return itemRank.passed;
};

export const getPaginationParams = (
  searchParams: Record<string, any>,
  defaultPageSize: number,
  prefix?: string | undefined
): PaginationState => {
  const pageSizeName = getPrefixedName('pageSize', prefix);
  const pageIndexName = getPrefixedName('pageIndex', prefix);

  const pageSize = searchParams[pageSizeName];
  const pageIndex = searchParams[pageIndexName];
  return {
    pageSize: pageSize ? Number(pageSize) : defaultPageSize,
    pageIndex: pageIndex ? Number(pageIndex) : 0,
  };
};
export const getSortParams = (
  searchParams: Record<string, any>,
  prefix?: string | undefined
): SortingState => {
  const sortColName = getPrefixedName('sortCol', prefix);
  const sortDescName = getPrefixedName('sortDesc', prefix);

  const cols = searchParams[sortColName];
  const isDescs = searchParams[sortDescName]?.map((isDesc: any) => isDesc === 'true');
  if (cols?.length && cols?.length === isDescs?.length) {
    return cols?.map((col: any, i: number) => ({
      desc: isDescs[i],
      id: col,
    }));
  } else {
    return [];
  }
};
export const getGlobalFilterParam = (
  searchParams: Record<string, any>,
  prefix?: string | undefined
): string | undefined => {
  const paramName = getPrefixedName('search', prefix);

  return searchParams[paramName] ?? undefined;
};

export const getPrefixedName = (name: string, prefix?: string | undefined) =>
  prefix?.concat('_', name) ?? name;

export const getColumnFilterParam = (
  searchParams: Record<string, any>,
  prefix?: string | undefined
): ColumnFiltersState => {
  const paramName = getPrefixedName('colfilter', prefix);
  const paramValue = searchParams[paramName];
  try {
    return paramValue
      ? JSON.parse(atob(decodeURIComponent(paramValue))).map((item: { i: string; v: any }) => ({
          id: item.i,
          value: item.v,
        }))
      : [];
  } catch (parsingError) {
    return [];
  }
};

export const setPaginationParams = (
  state: PaginationState,
  searchParams: Record<string, any>,
  defaultPageSize: number,
  prefix?: string | undefined
) => {
  const pageSizeName = getPrefixedName('pageSize', prefix);
  const pageIndexName = getPrefixedName('pageIndex', prefix);
  delete searchParams[pageSizeName];
  delete searchParams[pageIndexName];
  if (state.pageSize !== defaultPageSize) {
    searchParams[pageSizeName] = String(state.pageSize);
  }
  if (state.pageIndex !== 0) {
    searchParams[pageIndexName] = String(state.pageIndex);
  }
  return searchParams;
};
export const setGlobalFilterParam = (
  state: string | undefined,
  searchParams: Record<string, any>,
  prefix?: string | undefined
) => {
  const paramName = getPrefixedName('search', prefix);
  delete searchParams[paramName];
  if (state) {
    searchParams[paramName] = state;
  }
  return searchParams;
};
export const stringifyColumnFilters = (state: ColumnFiltersState) =>
  btoa(JSON.stringify(state.map((item) => ({ i: item.id, v: item.value }))));
export const setColumnFilterParam = (
  state: ColumnFiltersState,
  searchParams: Record<string, any>,
  prefix?: string | undefined
) => {
  const paramName = getPrefixedName('colfilter', prefix);
  delete searchParams[paramName];
  if (state?.length) {
    searchParams[paramName] = stringifyColumnFilters(state);
  }
  return searchParams;
};

export const setSortParams = (
  state: SortingState,
  searchParams: Record<string, any>,
  prefix?: string | undefined
) => {
  const sortColName = getPrefixedName('sortCol', prefix);
  const sortDescName = getPrefixedName('sortDesc', prefix);
  delete searchParams[sortColName];
  delete searchParams[sortDescName];

  state.forEach((sort) => {
    searchParams[sortColName] = (searchParams[sortColName] ?? []).concat(String(sort.id));
    searchParams[sortDescName] = (searchParams[sortDescName] ?? []).concat(String(sort.desc));
  });
  return searchParams;
};

export const DebouncedInput = forwardRef<
  InputProps & {
    /** (ms) */
    debounce?: number;
    onChange: (value: any) => void;
  },
  'input'
>(({ value: initialValue, onChange, debounce = 500, ...otherProps }, ref) => {
  const [value, setValue] = React.useState(initialValue);

  React.useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  React.useEffect(() => {
    const timeout = setTimeout(() => {
      onChange(value);
    }, debounce);

    return () => clearTimeout(timeout);
  }, [value]);

  return (
    <Input ref={ref} {...otherProps} value={value} onChange={(e) => setValue(e.target.value)} />
  );
});
