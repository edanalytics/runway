export const enumValues = (e: object) => {
  const keys = Object.keys(e);
  return keys.slice(0, keys.length / 2);
};
