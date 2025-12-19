import { enumValues } from './enum-values';

enum Test {
  One,
  Two,
  Three,
}

describe('enum-values', () => {
  it('should get keys but not names', () => {
    expect(enumValues(Test)).toEqual(['0', '1', '2']);
  });
});
