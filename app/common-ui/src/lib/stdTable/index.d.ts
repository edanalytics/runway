// TODO put this file in your front end app directories to type the meta column property.
import '@tanstack/react-table'
import { RowData } from '@tanstack/react-table'

declare module '@tanstack/react-table' {
  interface ColumnMeta<TData extends RowData, TValue> {
    type: 'date' | 'duration' | 'number' | 'options' | 'str-equals'
  }
}
