import dayjs from 'dayjs';
import localizedFormat from 'dayjs/plugin/localizedFormat';

dayjs.extend(localizedFormat);

export const stdShort = (date: Date | undefined) =>
  date === undefined ? '-' : dayjs(date).format('l');

export const stdMed = (date: Date | undefined) =>
  date === undefined ? '-' : dayjs(date).format('l h:mm a');

export const stdDetailed = (date: Date | undefined) =>
  date === undefined ? '-' : dayjs(date).format('MMM D, YYYY h:mm:ss A');

export const stdDiffSeconds = (start: Date, end: Date) =>
  dayjs(end).diff(start, 'second').toLocaleString() + 's';

export const stdDuration = (s: number) => {
  const hr = Math.floor(s / (1 * 60 * 60));
  let rem = s % (1 * 60 * 60);
  const min = Math.floor(rem / (1 * 60));
  rem = rem % (1 * 60);
  const sec = Math.floor(rem / 1);
  return `${hr ? `${hr}h ` : ''}${min ? `${min}m ` : ''}${sec || (!min && !hr) ? `${sec}s` : ''}`;
};
