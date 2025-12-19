// StdTablePagination.tsx
import React from 'react';
import { useStdTableContext } from './StdTableProvider';
import { PaginationControls } from './PaginationControls';
import { StackProps } from '@chakra-ui/react';

export const StdTablePagination: React.FC<StackProps> = (props) => {
  const { table, pageSizes } = useStdTableContext();

  if (!table) {
    return null as any;
  }

  const pageIndex = table.getState().pagination.pageIndex;
  const pageCount = table.getPageCount();
  const canPreviousPage = table.getCanPreviousPage();
  const canNextPage = table.getCanNextPage();

  const onFirstPage = () => table.setPageIndex(0);
  const onPreviousPage = () => table.previousPage();
  const onNextPage = () => table.nextPage();
  const onLastPage = () => table.setPageIndex(pageCount - 1);
  const onPageSizeChange = (size: number) => table.setPageSize(size);

  return table.getPageCount() > 1 ||
    table.getPrePaginationRowModel().rows.length > Math.min(...pageSizes) ? (
    <PaginationControls
      pageIndex={pageIndex}
      pageCount={pageCount}
      canPreviousPage={canPreviousPage}
      canNextPage={canNextPage}
      onFirstPage={onFirstPage}
      onPreviousPage={onPreviousPage}
      onNextPage={onNextPage}
      onLastPage={onLastPage}
      pageSizes={pageSizes}
      pageSize={table.getState().pagination.pageSize}
      onPageSizeChange={onPageSizeChange}
      {...props}
    />
  ) : null;
};
