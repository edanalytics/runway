import { ClassConstructor, plainToInstance } from 'class-transformer';

export const makeSerializer = <OutputType, GetterKeyTypes extends keyof OutputType = never>(
  dto: ClassConstructor<OutputType>
) => {
  function serialize(input: Omit<OutputType, GetterKeyTypes>): OutputType;
  function serialize(input: Omit<OutputType, GetterKeyTypes>[]): OutputType[];
  function serialize(input: Omit<OutputType, GetterKeyTypes> | Omit<OutputType, GetterKeyTypes>[]) {
    if (Array.isArray(input)) {
      return plainToInstance(dto, input, { excludeExtraneousValues: true });
    } else {
      return plainToInstance(dto, input, { excludeExtraneousValues: true });
    }
  }

  return serialize;
};

export const makeSerializerCustomType = <OutputType, InputType = OutputType>(
  dto: ClassConstructor<OutputType>
) => {
  function serialize(input: InputType[]): OutputType[];
  function serialize(input: InputType): OutputType;
  function serialize(input: InputType | InputType[]) {
    if (Array.isArray(input)) {
      return plainToInstance(dto, input, { excludeExtraneousValues: true });
    } else {
      return plainToInstance(dto, input, { excludeExtraneousValues: true });
    }
  }

  return serialize;
};
