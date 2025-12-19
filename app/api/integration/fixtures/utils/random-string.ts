// use me to populate data that can be used for test comparisons
export const randomString = (prefix: string = '', length: number = 10) => {
  prefix = prefix.length > 0 ? `${prefix}-` : '';
  return `${prefix}${Math.random()
    .toString(36)
    .substring(2, 2 + length)}`;
};
