import {
  FormControl,
  FormControlProps,
  FormErrorMessage,
  FormLabel,
  Input,
  InputProps,
} from '@chakra-ui/react';
import { FieldError, UseFormRegisterReturn } from 'react-hook-form';

export const RunwayInput = <K extends string>({
  label,
  error,
  register,
  type = 'text',
  ...formControlProps
}: {
  label: string;
  error: FieldError | undefined;
  register: UseFormRegisterReturn<K>;
  type?: InputProps['type'];
} & FormControlProps) => {
  return (
    <FormControl isInvalid={!!error} {...formControlProps}>
      <FormLabel>{label}</FormLabel>
      <Input {...register} type={type} autoComplete="off" errorBorderColor="transparent" />
      <FormErrorMessage>{error?.message}</FormErrorMessage>
    </FormControl>
  );
};
