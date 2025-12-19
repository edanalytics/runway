import { lazy, useEffect, useState } from 'react';
import logoUrl from './assets/logo.svg';
import backgroundUrl from './assets/background-logo.svg';
import rightArrowUrl from './assets/icon-arrow-right.svg';
const appPromise = import('./app/app');
const App = lazy(() => appPromise);

/**
 * This is written without the benefit of Chakra, React-query, or other
 * things, just for the purpose of being the smallest bundle possible.
 */

const colors = {
  blue: '#004364',
  green100: '#87E9DA',
  green600: '#004B4B',
};

export const Landing = () => {
  const [status, setStatus] = useState<
    'loading' | 'authenticated' | 'unauthenticated' | 'failed-authentication'
  >('loading');
  const [loginUrl, setLoginUrl] = useState('');
  useEffect(() => {
    setLoginUrl(
      import.meta.env.VITE_API_URL.replace(/\/?$/, '') +
        '/api/auth/login?redirect=' +
        encodeURIComponent(
          window.location.pathname === '/unauthenticated'
            ? '/'
            : window.location.pathname + window.location.search
        ) +
        '&origin=' +
        encodeURIComponent(window.location.origin) // origin not always included in request headers, so send as query param
    );

    if (window.location.pathname === '/unauthenticated') {
      setStatus('failed-authentication');
      return;
    }

    fetch(import.meta.env.VITE_API_URL.replace(/\/?$/, '') + '/api/auth/me', {
      credentials: 'include',
    })
      .then((res) => {
        if (res.ok) {
          setStatus('authenticated');
        } else {
          setStatus('unauthenticated');
          window.history.pushState(null, '', window.location.origin);
        }
      })
      .catch(() => {
        setStatus('unauthenticated');
        window.history.pushState(null, '', window.location.origin);
      });
  }, []);

  useEffect(() => {
    const altMatomoSubdomain = import.meta.env.VITE_ALTERNATE_MATOMO_SUBDOMAIN;
    if (altMatomoSubdomain && window.location.hostname.includes(altMatomoSubdomain)) {
      const altMatomoURL = import.meta.env.VITE_ALTERNATE_MATOMO_URL;
      const altMatomoSiteId = import.meta.env.VITE_ALTERNATE_MATOMO_SITE_ID;
      if (!altMatomoURL || !altMatomoSiteId) {
        return;
      }

      const _paq = (window._paq = window._paq || []);
      /* tracker methods like "setCustomDimension" should be called before "trackPageView" */
      _paq.push(['trackPageView']);
      _paq.push(['enableLinkTracking']);
      (function () {
        var u = altMatomoURL;
        _paq.push(['setTrackerUrl', u + 'matomo.php']);
        _paq.push(['setSiteId', altMatomoSiteId]);
        var d = document,
          g = d.createElement('script'),
          s = d.getElementsByTagName('script')[0];
        g.async = true;
        g.src = u + 'matomo.js';
        if (s && s.parentNode) {
          s.parentNode.insertBefore(g, s);
        }
      })();
    }
  }, []);

  if (status === 'loading') {
    return null;
  } else if (status === 'unauthenticated' || status == 'failed-authentication') {
    return (
      <>
        <div
          style={{
            backgroundColor: colors.blue,
            height: '100vh',
            width: '100vw',
            overflow: 'clip',
          }}
        >
          <div style={{ height: '1rem' }}></div>
          <main
            style={{
              height: '100%',
              display: 'flex',
              overflow: 'auto',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              background: `url(${backgroundUrl})`,
              backgroundRepeat: 'no-repeat',
              backgroundSize: 'cover',
              backgroundPosition: 'top',
            }}
          >
            <div
              style={{
                margin: 'auto',
                height: 'min-content',
                display: 'flex',
                width: '100%',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '3.5rem',
              }}
            >
              <div
                style={{
                  background: 'white',
                  borderRadius: '8px',
                  padding: '3.5rem 0',
                  width: '100%',
                  maxWidth: '34rem',
                }}
              >
                <img src={logoUrl} alt="logo" style={{ width: '100%', maxWidth: '17rem' }} />
              </div>
              <button
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '1rem 6rem',
                  border: 'none',
                  borderRadius: '8px',
                  color: colors.green600,
                  background: colors.green100,
                  fontSize: '1rem',
                  fontFamily: 'Frederik, sans-serif',
                  fontWeight: 600, // normally, this would be specified closer to where the text is used, but if not specified here the 400 weight font file is included in the bundle
                  cursor: 'pointer',
                  gap: '0.5rem',
                }}
                onClick={
                  // hard re-login if auth failed, otherwise just redirect to login
                  status === 'failed-authentication'
                    ? () => {
                        const url = new URL(loginUrl);
                        url.searchParams.set('forceLogin', 'true');
                        url.searchParams.set('origin', window.location.origin);
                        window.location.href = url.toString();
                      }
                    : () => (window.location.href = loginUrl)
                }
              >
                log in <img src={rightArrowUrl} alt="login arrow icon" />
              </button>
              <div
                style={{
                  visibility: status === 'failed-authentication' ? 'visible' : 'hidden',
                  marginTop: '-2.5rem',
                  maxWidth: '35rem',
                }}
              >
                <p
                  style={{
                    color: '#CFB2D1',
                    fontSize: '1rem',
                    fontFamily: 'Frederik, sans-serif',
                    fontWeight: 600,
                  }}
                >
                  Runway was unable to log you in. If you entered an incorrect email or tenant, you
                  can try logging in again. Otherwise, contact your district administrator to
                  confirm your user record is configured for Runway access.
                </p>
              </div>
            </div>
          </main>
        </div>
      </>
    );
  } else {
    return <App />;
  }
};
