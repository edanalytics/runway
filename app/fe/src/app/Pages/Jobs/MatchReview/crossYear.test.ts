import { describe, expect, it } from 'vitest';
import { crossYearOf } from './crossYear';

// A 2024–25 job.
const endYear = 2025;

describe('crossYearOf', () => {
  it("is in-year when the student's school years include the job's", () => {
    const rosterDetails = { first_name: 'Ana', last_name: 'Ruiz', school_years: [2024, 2025] };
    expect(crossYearOf(rosterDetails, endYear)).toBe('in-year');
  });

  it("is cross-year when the student's school years leave out the job's", () => {
    const rosterDetails = { first_name: 'Ana', last_name: 'Ruiz', school_years: [2023, 2024] };
    expect(crossYearOf(rosterDetails, endYear)).toBe('cross-year');
  });

  it('is unknown when the student has no school years', () => {
    const rosterDetails = { first_name: 'Ana', last_name: 'Ruiz' };
    expect(crossYearOf(rosterDetails, endYear)).toBe('unknown');
  });

  it('is unknown when a school year is not an integer, even if the job’s is among them', () => {
    const rosterDetails = { first_name: 'Ana', last_name: 'Ruiz', school_years: [2025, '2024'] };
    expect(crossYearOf(rosterDetails, endYear)).toBe('unknown');
  });

  it('is unknown without roster details', () => {
    expect(crossYearOf(null, endYear)).toBe('unknown');
  });
});
