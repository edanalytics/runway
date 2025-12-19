import { CellContext } from '@tanstack/react-table';
import { DateFormat, DateValue } from '..';

export function ValueAsDate(param?: { default?: DateFormat }) {
  return (info: CellContext<any, unknown>) => {
    const value = info.getValue();
    return typeof value === 'number' ? (
      <DateValue value={new Date(value)} defaultDateFmt={param?.default} />
    ) : value instanceof Date ? (
      <DateValue value={value} defaultDateFmt={param?.default} />
    ) : null;
  };
}
