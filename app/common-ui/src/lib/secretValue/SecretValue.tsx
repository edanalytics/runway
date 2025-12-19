import { Attribute } from '..';

export type JsonSecret = { key: string; secret: string; url: string };

export const SecretValue = (props: { secret: JsonSecret }) => {
  return (
    <>
      <Attribute label="Key" value={props.secret.key} isCopyable />
      <Attribute label="Secret" value={props.secret.secret} isMasked isCopyable />
      <Attribute label="URL" value={props.secret.url} isUrl isUrlExternal isCopyable />
    </>
  );
};
