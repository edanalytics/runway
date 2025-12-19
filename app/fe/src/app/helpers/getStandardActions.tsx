import { Icon } from '@chakra-ui/react';
import { ConfirmAction } from '@edanalytics/common-ui';
import { MutateOptions } from '@tanstack/react-query';
import { AnyRoute, Link } from '@tanstack/react-router';
import { AxiosResponse } from 'axios';
import { BiEdit, BiTrash } from 'react-icons/bi';
import { HiOutlineEye } from 'react-icons/hi';

export const StandardRowActions = <
  RowType extends {
    getValue: () => unknown;
    row: { original: { id: number } };
  },
  RouteType extends AnyRoute = AnyRoute,
  ParamsType extends object | ((a: object) => object) = (a: object) => object
>(props: {
  route: RouteType;
  info: RowType;
  params: ParamsType;
  mutation: (
    variables: number,
    options?: MutateOptions<AxiosResponse<unknown, unknown>, unknown, number, unknown> | undefined
  ) => void;
}) => {
  const path = props.route.fullPath;
  return (
    <>
      <Link title="View" to={path} params={props.params}>
        <Icon fontSize="md" as={HiOutlineEye} />
      </Link>
      <Link title="Edit" to={path} params={props.params} search={{ edit: true }}>
        <Icon fontSize="md" as={BiEdit} />
      </Link>
      <ConfirmAction
        headerText={`Delete ${props.info.getValue()}?`}
        bodyText="You won't be able to get it back"
        action={() => {
          props.mutation(props.info.row.original.id);
        }}
      >
        {(props) => (
          <Icon
            role="button"
            fontSize="md"
            _hover={{ cursor: 'pointer' }}
            as={BiTrash}
            {...props}
          />
        )}
      </ConfirmAction>
    </>
  );
};
