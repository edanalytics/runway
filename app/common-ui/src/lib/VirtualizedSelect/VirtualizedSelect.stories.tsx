import { VirtualizedSelect } from '.';

export default {
  title: 'VirtualizedSelect',
  component: VirtualizedSelect,
};

const options = new Array(12000)
  .fill(null)
  .map((v) => Math.random())
  .map((v) => ({ label: String(v), value: v, subLabel: 'some text' }));

export const Standard = () => <VirtualizedSelect menuIsOpen options={options} />;
