import '@tanstack/react-table';
import { RowData } from '@tanstack/react-table';

declare module '@tanstack/react-table' {
  interface ColumnMeta<TData extends RowData, TValue> {
    type: 'date' | 'duration' | 'number' | 'options' | 'str-equals';
  }
}
