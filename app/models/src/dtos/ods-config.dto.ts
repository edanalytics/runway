import { Expose, Type } from 'class-transformer';
import { DtoGetBase, GetDto } from '../utils/get-base.dto';
import { makeSerializer } from '../utils/make-serializer';
import { DtoPostBase, PostDto } from '../utils/post-base.dto';
import { DtoPutBase, PutDto } from '../utils/put-base.dto';
import { OdsConfig, OdsConnection } from '@prisma/client';
import { IsNotEmpty } from 'class-validator';

/**
 * Basic DTO structure that's shared across HTTP-method-specific DTOs.
 * Intentionally private so consumers interact with the HTTP-method-specific DTOs.
 */
interface BaseOdsConfigDto {
  id: number;
  schoolYearId: string;
  host: string | null;
  clientId: string | null;
  clientSecret: string | null;
}

export class GetOdsConfigDto
  extends DtoGetBase
  implements GetDto<Omit<BaseOdsConfigDto, 'clientSecret'>>
{
  @Expose()
  id: number;

  @Expose()
  host: string;

  @Expose()
  clientId: string;

  // @Expose()
  // clientSecret: string;

  @Expose()
  schoolYearId: string;

  @Expose()
  lastUseResult: string;

  @Expose()
  @Type(() => Date)
  lastUseOn: Date | null;

  get displayName() {
    return this.host ?? 'Unconfigured';
  }
}

// Use this DTO when you need the secret. The idea is to that we don't want
// to pass the secret around willy-nilly, so this forces some intentionality.
export class GetOdsConfigWithSecretDto extends GetOdsConfigDto implements GetDto<BaseOdsConfigDto> {
  @Expose()
  clientSecret: string;
}

type DtoableEntity = OdsConfig & { activeConnection: OdsConnection };
const entityToDtoInput = (entity: DtoableEntity) => {
  return {
    ...entity,
    host: entity.activeConnection.host,
    clientId: entity.activeConnection.clientId,
    clientSecret: entity.activeConnection.clientSecret,
    lastUseResult: entity.activeConnection.lastUseResult,
    lastUseOn: entity.activeConnection.lastUseOn,
    schoolYearId: entity.activeConnection.schoolYearId,
  };
};

const toDtoInstance = makeSerializer<GetOdsConfigDto, 'displayName'>(GetOdsConfigDto);
export const toGetOdsConfigDto = (entity: DtoableEntity | DtoableEntity[]) => {
  return Array.isArray(entity)
    ? toDtoInstance(entity.map(entityToDtoInput))
    : toDtoInstance(entityToDtoInput(entity));
};

const toDtoInstanceWithSecret = makeSerializer<GetOdsConfigWithSecretDto, 'displayName'>(
  GetOdsConfigWithSecretDto
);
export const toGetOdsConfigWithSecretDto = (entity: DtoableEntity | DtoableEntity[]) => {
  return Array.isArray(entity)
    ? toDtoInstanceWithSecret(entity.map(entityToDtoInput))
    : toDtoInstanceWithSecret(entityToDtoInput(entity));
};

export class PutOdsConfigDto extends DtoPutBase implements PutDto<BaseOdsConfigDto> {
  @Expose()
  @IsNotEmpty({ message: 'EdFi base API URL is required' })
  host: string;

  @Expose()
  @IsNotEmpty({ message: 'key is required' })
  clientId: string;

  @Expose()
  @IsNotEmpty({ message: 'secret is required' })
  clientSecret: string;

  @Expose()
  @IsNotEmpty({ message: 'year is required' })
  schoolYearId: string;
}

export class PostOdsConfigDto extends DtoPostBase implements PostDto<BaseOdsConfigDto> {
  @Expose()
  @IsNotEmpty({ message: 'EdFi base API URL is required' })
  host: string;

  @Expose()
  @IsNotEmpty({ message: 'key is required' })
  clientId: string;

  @Expose()
  @IsNotEmpty({ message: 'secret is required' })
  clientSecret: string;

  @Expose()
  @IsNotEmpty({ message: 'year is required' })
  schoolYearId: string;
}
