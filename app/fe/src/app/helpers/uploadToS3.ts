export const uploadToS3 = (file: File, url: string) => {
  let credentials: RequestCredentials | undefined;
  try {
    const apiOrigin = new URL(import.meta.env.VITE_API_URL).origin;
    const uploadOrigin = new URL(url).origin;
    if (uploadOrigin === apiOrigin) {
      credentials = 'include';
    }
  } catch {
    // If the URL can't be parsed, fall back to a standard request.
  }

  return fetch(url, {
    method: 'PUT',
    body: file,
    headers: {
      'Content-Type': file.type,
    },
    ...(credentials ? { credentials } : {}),
  });
};
