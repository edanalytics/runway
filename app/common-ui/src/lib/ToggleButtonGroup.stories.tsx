import { Meta, StoryObj } from '@storybook/react';
import { ToggleButtonGroup } from './ToggleButtonGroup';
import { Button } from '@chakra-ui/react';
import { useState } from 'react';

const meta: Meta<typeof ToggleButtonGroup> = {
  title: 'ToggleButtonGroup',
  component: ToggleButtonGroup,
};
export default meta;

const StandardRender = () => {
  const [value, setValue] = useState('value1');
  return (
    <ToggleButtonGroup groupProps={{ isAttached: true }} value={value} onChange={setValue}>
      <Button value={'value1'}>label1</Button>
      <Button value={'value2'}>label2</Button>
    </ToggleButtonGroup>
  );
};

export const Standard = StandardRender;
