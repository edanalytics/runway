// https://github.com/edanalytics/earthmover_edfi_bundles/blob/main/registry.json

export enum EarthmoverBundleTypes {
  assessments = 'assessments',
}
export interface IEarthmoverBundle {
  display_name: string;
  valid_edfi: string;
  path: string;

  input_files: Array<{
    display_name: string;
    env_var: string;
    is_required: boolean;
    file_type: string[];
  }>;

  input_params?: Array<{
    display_name: string;
    env_var: string;
    is_required: boolean;
    allowed_values?: string[];
  }> | null; // handle missing key or explicit null

  report_resources: string[];
}

export interface IEarthmoverBundleRegistry
  extends Record<EarthmoverBundleTypes, IEarthmoverBundle[]> {}
