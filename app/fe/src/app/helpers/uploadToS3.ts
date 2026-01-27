export const uploadToS3 = (file: File, url: string) => {
  // local case: "uploading" file to a local URL; need this to get around CORS
  let credentials: RequestCredentials | undefined;
  try {
    const apiOrigin = new URL(import.meta.env.VITE_API_URL).origin;
    const uploadOrigin = new URL(url).origin;
    if (uploadOrigin === apiOrigin) {
      credentials = 'include';
    }
  } catch {}

  // deployed case: presigned URL so no creds needed

  return fetch(url, {
    method: 'PUT',
    body: file,
    headers: {
      'Content-Type': file.type,
    },
    ...(credentials ? { credentials } : {}),
  });
};
