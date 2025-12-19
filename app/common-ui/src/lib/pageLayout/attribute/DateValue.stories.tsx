import { DateValue } from './Attribute';

export default {
  title: 'DateValue',
  component: DateValue,
};

export const Standard = () => <DateValue value={new Date()} />;
