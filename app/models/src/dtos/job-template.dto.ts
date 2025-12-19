import { Expose } from 'class-transformer';
import { makeSerializer } from '../utils/make-serializer';
import { EarthmoverBundleTypes, IEarthmoverBundle } from '../interfaces';

export type JobTemplateType = keyof typeof EarthmoverBundleTypes;

export class GetJobTemplateDto {
  @Expose()
  name: string;

  @Expose()
  files: Array<{
    name: string;
    templateKey: string;
    isRequired: boolean;
    fileType: string[];
  }>;

  @Expose()
  params: GetJobTemplateInputParamDto[];

  @Expose()
  path: string;

  @Expose()
  reportResources?: string[] | null;
}

export class GetJobTemplateInputParamDto {
  @Expose()
  name: string;

  @Expose()
  templateKey: string;

  @Expose()
  isRequired: boolean;

  @Expose()
  allowedValues?: string[];
}

const toDtoable = (bundle: IEarthmoverBundle): GetJobTemplateDto => ({
  ...bundle,
  reportResources: bundle.report_resources,
  name: bundle.display_name,
  files: bundle.input_files.map((file) => ({
    name: file.display_name,
    templateKey: file.env_var,
    isRequired: file.is_required,
    fileType: file.file_type,
  })),
  params:
    bundle.input_params?.map((field) => ({
      name: field.display_name,
      templateKey: field.env_var,
      isRequired: field.is_required,
      allowedValues: field.allowed_values,
    })) ?? [],
});
const serializer = makeSerializer<GetJobTemplateDto>(GetJobTemplateDto);

export function toGetJobTemplateDto(bundle: IEarthmoverBundle): GetJobTemplateDto;
export function toGetJobTemplateDto(bundle: IEarthmoverBundle[]): GetJobTemplateDto[];
export function toGetJobTemplateDto(
  bundle: IEarthmoverBundle | IEarthmoverBundle[]
): GetJobTemplateDto | GetJobTemplateDto[] {
  return Array.isArray(bundle) ? serializer(bundle.map(toDtoable)) : serializer(toDtoable(bundle));
}
