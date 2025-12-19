import { IEarthmoverBundle } from '@edanalytics/models';

export const bundleA: IEarthmoverBundle = {
  display_name: 'bundle-a',
  valid_edfi: '1.0',
  path: 'bundle/a',
  input_files: [
    {
      display_name: 'Assessment data',
      env_var: 'INPUT_FILE',
      is_required: true,
      file_type: ['csv', 'txt'],
    },
  ],
  input_params: [
    {
      display_name: 'School Year',
      env_var: 'API_YEAR',
      is_required: true,
    },
    {
      display_name: 'Reporting Data Format',
      env_var: 'FORMAT',
      is_required: true,
      allowed_values: ['Standard', 'End-of-Course', 'Alternate', 'End-of-Course Alternate'],
    },
  ],
  report_resources: ['studentAssessments'],
};

export const bundleB: IEarthmoverBundle = {
  ...bundleA,
  display_name: 'bundle-b',
  path: 'bundle/b',
};

export const bundleM: IEarthmoverBundle = {
  ...bundleA,
  display_name: 'bundle-m',
  path: 'bundle/m',
};

export const bundleX: IEarthmoverBundle = {
  ...bundleA,
  display_name: 'bundle-x',
  path: 'bundle/x',
};

export const bundleY: IEarthmoverBundle = {
  ...bundleA,
  display_name: 'bundle-y',
  path: 'bundle/y',
};

export const partnerABundles = [bundleA, bundleB];
export const partnerXBundles = [bundleX, bundleY];
export const allBundles = [...partnerABundles, ...partnerXBundles, bundleM];
