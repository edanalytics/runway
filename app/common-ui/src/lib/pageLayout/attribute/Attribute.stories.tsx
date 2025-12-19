import { Attribute } from '.';

export default {
  title: 'Attribute',
  component: Attribute,
};

export const ExternalUrl = () => (
  <Attribute
    label="URL"
    value="https://gbhs-test-5.mth-dev-61a.eaedfi.edanalytics.org/"
    isUrl
    isUrlExternal
  />
);

export const CopyableExternalUrl = () => (
  <Attribute
    label="URL"
    value="https://gbhs-test-5.mth-dev-61a.eaedfi.edanalytics.org/"
    isUrl
    isUrlExternal
    isCopyable
  />
);
export const InternalUrl = () => <Attribute label="URL" value="/some-path" isUrl isCopyable />;
export const Secret = () => <Attribute label="Secret" value="nbMMc1Xzlb38fshlCp2UYDjj" isMasked />;
export const CopyableSecret = () => (
  <Attribute label="Secret" value="nbMMc1Xzlb38fshlCp2UYDjj" isCopyable isMasked />
);
export const DateValue = () => <Attribute label="Date value" value={new Date()} isDate />;
export const CopyableDateValue = () => (
  <Attribute label="Date value" value={new Date()} isCopyable isDate />
);
export const CopyableSecretDateValue = () => (
  <Attribute label="Date value" value={new Date()} isCopyable isDate isMasked />
);
