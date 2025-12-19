import { Link, Text } from '@chakra-ui/react';
import { kebabCase } from '@edanalytics/utils';
import { UseQueryResult } from '@tanstack/react-query';
import { Link as RouterLink } from '@tanstack/react-router';
import { getEntityFromQuery, getRelationDisplayName } from '../helpers';

/** __Make standard link component.__
 *
 * Extrapolates the various configurations from the given `entityName`, including kebab-case route
 * path and camelCase path parameter, so is very reliant on convention. It is expected that this
 * is just a starting point and will have to evolve with the app, which is why it's part of the
 * app directory instead of common-ui.
 */
export const makeLink = <DtoType extends { id: number | string; displayName: string }>(params: {
  /** for example "NiceEntity" */
  entityName: string;
  /** Only needed if different from `${entityName}s`, for example "NiceEntities" rather than "NiceEntitys" */
  entityNamePlural?: string | undefined;
  /** Singular display name of the entity. Defaults to "NiceEntity" */
  displayName?: string | undefined;
}) => {
  const baseName = params.entityName.trim().replace(/s$/, '');
  const displayName = params.displayName ?? baseName;
  const titleName = displayName.substring(0, 1).toLocaleUpperCase() + displayName.substring(1);
  const sentenceName = displayName.substring(0, 1).toLocaleLowerCase() + displayName.substring(1);
  const paramName = baseName + 'Id';
  const kebabName = kebabCase(
    params.entityNamePlural ? params.entityNamePlural.trim() : baseName + 's'
  );

  return (props: {
    id: number | undefined;
    query: Pick<UseQueryResult<Record<string | number, DtoType>, unknown>, 'data'>;
  }) => {
    const entity = getEntityFromQuery(props.id, props.query);
    return entity ? (
      <Link as="span">
        <RouterLink
          title={`Go to ${sentenceName}`}
          to={`/${kebabName}/$${paramName}`}
          params={{
            [paramName]: String(entity.id),
          }}
        >
          {getRelationDisplayName(entity.id, props.query)}
        </RouterLink>
      </Link>
    ) : typeof props.id === 'number' ? (
      <Text title={`${titleName} may have been deleted.`} as="i" color="gray.500">
        not found
      </Text>
    ) : null;
  };
};
