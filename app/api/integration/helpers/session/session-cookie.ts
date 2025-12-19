import signature from 'cookie-signature';

const randomSid = () => {
  return Math.random().toString(36).substring(2, 10);
};

export const sessionCookie = (scope: string = 'test-session') => {
  const sid = `${scope}-${randomSid()}`;
  const signedId = encodeURIComponent('s:' + signature.sign(sid, 'my-secret'));
  return {
    sid,
    cookie: 'connect.sid=' + signedId,
  };
};

export const sidFromCookie = (cookie: string | string[]) => {
  if (Array.isArray(cookie)) {
    cookie = cookie.find((c) => c.startsWith('connect.sid='))!;
  }
  // Example:"connect.sid=s%3A78ipfdFRzRoZRC7fKEOYMFkiohjJ5Xyu.PnNY19y7foeflO2qHoawqCcI83Rs6Xi6tDKAqSX4jkY; Path=/; HttpOnly"
  const signedId = decodeURIComponent(cookie.split('=')[1].split(';')[0]).split('s:')[1]; // yuck, but it's fine
  const sid = signature.unsign(signedId, 'my-secret');
  if (sid === false) {
    throw new Error('Invalid session cookie');
  }
  return sid;
};
