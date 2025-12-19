import { faker } from '@faker-js/faker';

export type Person = {
  id: string;
  firstName: string;
  lastName: string;
  age: number;
  visits: number;
  progress: number;
  status: 'relationship' | 'complicated' | 'single';
  createdAt: Date;
  subRows?: Person[];
};

const range = (len: number) => {
  const arr = [];
  for (let i = 0; i < len; i++) {
    arr.push(i);
  }
  return arr;
};

const newPerson = (): Person => {
  return {
    id: faker.string.uuid(),
    firstName: faker.person.firstName(),
    lastName: faker.person.lastName(),
    age: faker.number.int(40),
    visits: faker.number.int(1000),
    progress: faker.number.int(100),
    createdAt: faker.date.past(),
    status: faker.helpers.shuffle<Person['status']>(['relationship', 'complicated', 'single'])[0]!,
  };
};

export function makeData(count: number) {
  return range(count).map((d): Person => newPerson());
}
