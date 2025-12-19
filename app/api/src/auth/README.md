# Authentication and Authorization

At a high level, here is how auth is handled:

- User logs in via one of the login [options](#authentication-options).
- App looks up the appropriate user record and [saves it in a cache](#session-cache).
- App creates a random opaque "Session ID" (`sid`), which is basically the key for that cache record, and passes it to the client in the [`Set-Cookie` response header](#http-cookies).
- If the client is a browser (as opposed to someone running cURL, say), that cookie is [automatically included](#credentials-inclusion) in all subsequent requests to the API's domain.
- The rest of the API requests are authenticated by using that `Cookie` request header to [look up the user's session](#normal-request-authentication).
- To cause a logout, the cached [session record is destroyed](#logout).

## Authentication options

Some options ("strategies"), such as HTTP Basic, consist of a single POST route. Others, such as OIDC, involve more than one route:

1. Go to the `/login` route (anybody can go here).
1. Get redirected to an external IdP.
   - ...do things...
1. Get redirected back, this time to the `/callback` route (the data that you might call the authentication "result" is in the redirect URL, and it's parsed by PassportJS)

A strategy could have any kind of unique logic in it, but the end result is always the same: a user object to store in the authentication session cache.

## Automatic user creation

## Session cache

This could be any number of things, including trivial options such as a JavaScript variable or more elaborate ones like Redis or Postgres.

The usual reasons to stay away from in-memory options like a JS variable or a Redis emulator are: (a) volatility, or the issue of losing all the data in a crash and restart, and (b) an in-memory cache would be impossible to share if there are multiple parallel instances.

## HTTP cookies

There is a kind of cookie called "HTTP-only" which is not accessible by JavaScript. Instead, it's set by the browser itself automatically whenever an API response includes a `Set-Cookie` header, and front-end JS never even knows about it.

### Credentials inclusion

Although HTTP cookie sessions are in principle "automatic" in the sense that the front-end doesn't have to do anything, there are still some things that need to be configured:

- Front-end API requests need to be sent using `credentials = include`, which tells the browser to include its HTTP-only cookie.
- API responses need to include the header `Access-Control-Allow-Credentials = true`, which tells the browser to let JavaScript access the response.

## Normal request authentication

The login and login-callback routes have their own unique handlers, but normal API requests are authenticated simply by attempting to look up a session using the `sid` cookie from the request header.

While Passport itself doesn't care if its lookup fails, there's a Guard that checks for the result, and _that's_ where the requests actually get rejected if there's no session. There's also a very simple `@Public()` decorator which just adds a property telling the guard not to run on the given route.

> If there's' no `Cookie` header, or there's no `sid` value _in_ the header, or the `sid` doesn't work, or if for any reason the lookup fails, then the request is deemed unauthenticated and returns a 401. The front-end of this app is built to catch 401s and redirect the user to login.

The retrieved session value is then stored in the NestJS request pipeline for any subsquent handlers to use it. In general, this will include authorization checkers and the ultimate route controller. Controllers are given access to the session object by the `@ReqUser()` decorator which pulls it out of the request pipeline and puts it into a handler parameter.

## Logout

Because of the way request authentication works, all that's needed in order to log a user out is to delete their session, because that will guarantee that all subsequent requests using their old `sid` will fail.
