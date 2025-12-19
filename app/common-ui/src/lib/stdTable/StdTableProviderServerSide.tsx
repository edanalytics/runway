import { useBoolean } from '@chakra-ui/react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import {
  ColumnDef,
  ColumnFiltersState,
  OnChangeFn,
  RowSelectionState,
  SortingState,
  Table,
  getCoreRowModel,
  getExpandedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import cloneDeep from 'lodash/cloneDeep';
import isEqual from 'lodash/isEqual';
import React, { useEffect, useMemo } from 'react';
import { StdTableContext } from '.';
import {
  fuzzyFilter,
  getColumnFilterParam,
  getGlobalFilterParam,
  getPaginationParams,
  getSortParams,
  setColumnFilterParam,
  setGlobalFilterParam,
  setPaginationParams,
  setSortParams,
} from '../dataTable';

export function StdTableProviderServerSide<
  UseSubRows extends boolean,
  T extends UseSubRows extends true ? { id: any; subRows: T[] } : { id: any }
>(props: {
  useSubRows?: UseSubRows;
  children?: React.ReactNode;
  data: T[] | IterableIterator<T>;
  facetedValues: undefined | Record<string, string[] | { min: number, max: number }>;
  columns: ColumnDef<T>[];
  enableRowSelection?: boolean;
  rowSelectionState?: RowSelectionState;
  onRowSelectionChange?: OnChangeFn<RowSelectionState> | undefined;
  pageSizes?: number[];
  rowCount: number;
  queryKeyPrefix?: string | undefined;
}) {
  const data = useMemo(() => [...props.data], [props.data]);
  const pageSizes = props.pageSizes ?? [10, 25, 50, 100];

  const navigate = useNavigate();
  const _searchParams: object = useSearch({ strict: false });
  const _setSearchParams = (newValue: object) =>
    navigate({
      search: newValue as any,
    });
  // detach mutations which ruin diff
  const searchParams = cloneDeep(_searchParams);
  const setSearchParamsColFilter = (newValue: object) => {
    if (!isEqual(_searchParams, newValue)) {
      _setSearchParams({ ...newValue, [props.queryKeyPrefix + '_' + 'colFilterTouched']: true });
    }
  };
  const setSearchParamsSort = (newValue: object) => {
    if (!isEqual(_searchParams, newValue)) {
      _setSearchParams({ ...newValue, [props.queryKeyPrefix + '_' + 'sortTouched']: true });
    }
  };
  const setSearchParamsGlobalFilter = (newValue: object) => {
    if (!isEqual(_searchParams, newValue)) {
      _setSearchParams({ ...newValue, [props.queryKeyPrefix + '_' + 'globalFilterTouched']: true });
    }
  };

  const columnFilters = getColumnFilterParam(searchParams, props.queryKeyPrefix);
  const setColumnFilters = (
    updater: ColumnFiltersState | ((old: ColumnFiltersState) => ColumnFiltersState)
  ) => {
    if (typeof updater === 'function') {
      setSearchParamsColFilter(
        setColumnFilterParam(updater(columnFilters), searchParams, props.queryKeyPrefix)
      );
    } else {
      setSearchParamsColFilter(setColumnFilterParam(updater, searchParams, props.queryKeyPrefix));
    }
  };
  const [pendingFilterColumn, setPendingFilterColumn] = React.useState<string | boolean>(false);

  const globalFilter = getGlobalFilterParam(searchParams, props.queryKeyPrefix);
  const sortParams = getSortParams(searchParams, props.queryKeyPrefix);

  const setGlobalFilter = (value: string | undefined) => {
    setSearchParamsGlobalFilter(setGlobalFilterParam(value === '' ? undefined : value, setSortParams(
      value?.length && !globalFilter?.length ?
        // default sort first by relevance when search starts
        [{ id: 'ftSearch', desc: true }, ...sortParams] :
        // remove relevance sort when search ends
        !value?.length ?
          sortParams.filter(state => state.id !== 'ftSearch') :
          // otherwise don't change sort
          sortParams,
      searchParams,
      props.queryKeyPrefix
    ), props.queryKeyPrefix));
  };

  const paginationParams = getPaginationParams(searchParams, pageSizes[0], props.queryKeyPrefix);

  const showSettings = useBoolean(sortParams.length > 1 || columnFilters.length > 0);

  const table = useReactTable({
    data,
    columns: [...props.columns, { id: 'ftSearch', header: 'Relevance', accessorFn: () => null }],
    filterFns: {
      fuzzy: fuzzyFilter,
    },
    state: {
      sorting: sortParams,
      globalFilter,
      columnFilters,
      ...(props.rowSelectionState ? { rowSelection: props.rowSelectionState } : {}),
      pagination: paginationParams,
      columnVisibility: { ftSearch: !!globalFilter }
    },
    onSortingChange: (updater) =>
      setSearchParamsSort(
        setSortParams(
          typeof updater === 'function' ? updater(sortParams) : updater,
          searchParams,
          props.queryKeyPrefix
        )
      ),
    onPaginationChange: (updater) =>
      setSearchParamsSort(
        setPaginationParams(
          typeof updater === 'function' ? updater(paginationParams) : updater,
          searchParams,
          pageSizes[0],
          props.queryKeyPrefix
        )
      ),
    globalFilterFn: fuzzyFilter,
    ...(props.onRowSelectionChange ? { onRowSelectionChange: props.onRowSelectionChange } : {}),
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getFacetedMinMaxValues: (table, columnId) => () => {
      const columnDef = table.getColumn(columnId)!.columnDef
      if (props.facetedValues && (columnDef as any)?.meta?.type === 'number') {
        const result = props.facetedValues?.[columnId] as { min: number, max: number };
        return [result.min, result.max];
      } else {
        return undefined
      }
    },
    getFacetedUniqueValues: (table, columnId) => () => {
      const columnDef = table.getColumn(columnId)!.columnDef
      if (props.facetedValues && (columnDef as any)?.meta?.type === 'options') {
        const result = props.facetedValues?.[columnId] as string[] ?? [];
        return new Map(result.map((v) => [v, 1]));
      } else {
        return new Map();
      }
    },
    getExpandedRowModel: props.useSubRows ? getExpandedRowModel() : undefined,
    enableMultiRowSelection: props.enableRowSelection,
    getRowId: (row) => row.id,
    enableMultiSort: true,
    debugTable: false,
    autoResetPageIndex: false,
    manualFiltering: true,
    manualPagination: true,
    manualSorting: true,
    pageCount: Math.ceil(props.rowCount / paginationParams.pageSize),
    initialState: {
      pagination: {
        pageSize: pageSizes[0],
      },
    },
  });

  useEffect(() => {
    if (table.getState().pagination.pageIndex > table.getPageCount() - 1) {
      table.setPageIndex(table.getPageCount() - 1);
    }
  }, [props.rowCount, paginationParams.pageSize, paginationParams.pageIndex]);

  return (
    <StdTableContext.Provider
      value={{
        table,
        pageSizes,
        pendingFilterColumn,
        setPendingFilterColumn,
        isRowSelectionEnabled: props.enableRowSelection,
        showSettings,
      }}
    >
      {props.children}
    </StdTableContext.Provider>
  );
}


export const makeFilterQuery = (filter: ColumnFiltersState) => filter.map(f => {
  if (Array.isArray(f.value)) {
    // [gte, lte]
    return f.value
      .map((v, i) => v === null ?
        null :
        `${f.id}_${i === 0 ? 'gte' : 'lte'}=${v}`
      )
      .filter(v => v !== null).join('&')
  } else {
    // plain value
    return `${f.id}_eq=${encodeURIComponent(String(f.value))}`
  }
})

export const makeSortQuery = (sort: SortingState) => sort
  .map((s) => `sortCol[]=${s.id}&sortDesc[]=${s.desc}`)

/**
 * Turn state into search params. Result looks like `paramOne=1&param2=2`
 * &mdash; i.e. no leading `?` or trailing `&`.
 */
export const makeTableStateUrlQuery = ({ pageIndex, sort, filter, pageSize, search }: {
  pageIndex?: number,
  sort?: SortingState,
  filter?: ColumnFiltersState,
  pageSize?: number,
  search?: string,
}) => [
  filter ? makeFilterQuery(search ? [...filter, { id: 'ftSearch', value: search }] : filter) : [],
  pageIndex === undefined ? [] : [`pageIndex=${pageIndex + 1}`],
  pageSize === undefined ? [] : [`pageSize=${pageSize}`],
  sort ? makeSortQuery(sort) : [],
].flat().join('&')

export const makeDataUrlFactory = (path: string) => (props: {
  pageIndex?: number,
  sort?: SortingState,
  filter?: ColumnFiltersState,
  pageSize?: number,
  search?: string,
}) =>
  `${path}?${makeTableStateUrlQuery(props)}`;
