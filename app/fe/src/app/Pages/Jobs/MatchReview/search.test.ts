import { describe, expect, it } from '@jest/globals';
import {
  changedFields,
  isSameSearch,
  searchBlock,
  searchDetailsFrom,
  SearchTerms,
  termsFrom,
} from './search';

const terms = (overrides: Partial<SearchTerms> = {}): SearchTerms => ({
  first_name: 'Ana',
  last_name: 'Lopez',
  birth_date: '2012-04-01',
  student_ids: '123, 456',
  ...overrides,
});

describe('changedFields', () => {
  it('ignores surrounding spaces and the order and repeats of IDs', () => {
    expect(changedFields(terms(), terms({ first_name: ' Ana ', student_ids: '456 123' }))).toEqual(
      []
    );
    expect(isSameSearch(terms(), terms({ student_ids: '456,123, 456' }))).toBe(true);
  });

  it('names each changed, added or cleared field', () => {
    expect(
      changedFields(
        terms({ birth_date: '' }),
        terms({ last_name: 'López', student_ids: '123, 456, 789' })
      )
    ).toEqual(['last_name', 'birth_date', 'student_ids']);
  });
});

describe('searchBlock', () => {
  const file = terms();
  const edit = terms({ last_name: 'López' });

  it("blocks the file's values, already searched for the suggestions", () => {
    expect(searchBlock(terms({ first_name: ' Ana ' }), file, null)).toBe('file');
  });

  it('blocks the search whose results are shown, but not an earlier one', () => {
    expect(searchBlock(edit, file, edit)).toBe('shown');
    expect(searchBlock(edit, file, terms({ student_ids: '789' }))).toBeNull();
  });

  it('allows any edit before a search has returned results', () => {
    expect(searchBlock(edit, file, null)).toBeNull();
  });

  it('blocks a date that is not a real YYYY-MM-DD date', () => {
    expect(searchBlock(terms({ birth_date: '2012-02-30' }), file, null)).toBe('bad-date');
    expect(searchBlock(terms({ birth_date: '4/1/2012' }), file, null)).toBe('bad-date');
  });

  // So the date hint alone explains the disabled button: editing another
  // field wouldn't enable it.
  it("reports the bad date, not the file's values, when the file's own date is bad", () => {
    const fileWithBadDate = terms({ birth_date: '2012-4-1' });
    expect(searchBlock(fileWithBadDate, fileWithBadDate, null)).toBe('bad-date');
  });

  it('allows a blank date', () => {
    expect(searchBlock(terms({ birth_date: ' ' }), file, null)).toBeNull();
  });
});

// Some files repeat the same ID across columns.
describe('repeated IDs', () => {
  it('appear once in the form', () => {
    expect(termsFrom({ student_ids: ['123', '123', '456', '123'] }).student_ids).toBe('123, 456');
  });

  it('are sent once', () => {
    expect(searchDetailsFrom(terms({ student_ids: '123, 123 456' })).student_ids).toEqual([
      '123',
      '456',
    ]);
  });
});
