import { Select } from 'chakra-react-select';
import { MenuList } from './MenuList';
import { Option } from './Option';
import { SingleValue } from './SingleValue';
import { forwardRef } from 'react';
export const VirtualizedSelect = forwardRef((props: Parameters<typeof Select>[0], ref: any) => {
  return (
    <Select
      ref={ref}
      {...{
        ...props,
        components: {
          ...props.components,
          MenuList: MenuList,
          Option: Option,
          SingleValue: SingleValue,
        },
      }}
    />
  );
});
