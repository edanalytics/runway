import { describe, expect, it } from '@jest/globals';
import { valueText } from './values';

describe('valueText', () => {
  // Some files repeat the same ID across columns.
  it('shows a repeated ID once, keeping IDs of different types', () => {
    expect(valueText(['123', '123'])).toBe('123');
    expect(
      valueText([
        { id_type: 'State', id_value: '123' },
        { id_type: 'State', id_value: '123' },
        { id_type: 'Local', id_value: '123' },
      ])
    ).toBe('State 123, Local 123');
  });
});
