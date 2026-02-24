import { FormControl, FormLabel } from '@chakra-ui/react';
import { Select } from 'chakra-react-select';
import { FieldPath, FieldValues, UseControllerReturn } from 'react-hook-form';
import { useId } from 'react';

type SharedSelectProps = {
  label: string;
  options: { label: string; value: string }[] | undefined;
  defaultValue?: string;
  isOptionDisabled?: (option: { value: string }) => boolean;
};

type SelectWithController<
  T extends FieldValues = FieldValues,
  K extends FieldPath<T> = FieldPath<T>
> = SharedSelectProps & {
  controller: UseControllerReturn<T, K>;
};
type SelectWithField<
  T extends FieldValues = FieldValues,
  K extends FieldPath<T> = FieldPath<T>
> = SharedSelectProps & {
  field: UseControllerReturn<T, K>['field'];
  fieldState: UseControllerReturn<T, K>['fieldState'];
};

export const RunwaySelect = <T extends FieldValues, K extends FieldPath<T> = FieldPath<T>>({
  label,
  options,
  isOptionDisabled = () => false,
  ...rest
}: SelectWithController<T, K> | SelectWithField<T, K>) => {
  const { field, fieldState } = 'controller' in rest ? rest.controller : rest;
  const value = options?.find((option) => option.value === field.value);
  const inputId = useId();
  return (
    <FormControl isInvalid={fieldState.invalid} paddingX="0px">
      <FormLabel htmlFor={inputId} paddingX="200">{label}</FormLabel>
      <Select
        inputId={inputId}
        value={value}
        onChange={(e) => field.onChange(e?.value)}
        onBlur={field.onBlur}
        name={field.name}
        isInvalid={fieldState.invalid}
        menuPortalTarget={document.body}
        placeholder={fieldState.invalid ? fieldState.error?.message : 'select...'}
        variant="unstyled"
        options={options}
        isOptionDisabled={isOptionDisabled}
        chakraStyles={{
          menu: (baseStyles) => ({
            ...baseStyles,
            textStyle: 'body',
            textColor: 'blue.700',
            bg: 'blue.50',
            borderRadius: '0 0 8px 8px',
            marginTop: '-1px',
          }),
          control: (baseStyles) => ({
            ...baseStyles,
            paddingLeft: '200',
            paddingRight: '200',
            minWidth: '200px', // Hack that prevents react-select from resizing the form field when an option is selected
          }),
          option: (baseStyles) => ({ ...baseStyles, padding: '200' }),
          placeholder: (baseStyles) => ({
            ...baseStyles,
            textStyle: 'body',
            textColor: fieldState.invalid ? 'pink.100' : 'blue.100',
            margin: '0px',
          }),
          // align left flush with the label
          input: (baseStyles) => ({ ...baseStyles, marginLeft: '0px' }),
          singleValue: (baseStyles) => ({ ...baseStyles, marginLeft: '0px' }),
          valueContainer: (baseStyles) => ({ ...baseStyles, marginLeft: '0px' }),
          menuList: (baseStyles) => ({
            ...baseStyles,
            border: 'none',
          }),
        }}
      ></Select>
    </FormControl>
  );
};
