/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL of the back-end API */
  readonly VITE_API_URL: string;
  readonly VITE_SUPPORT_EMAIL: string;
  readonly VITE_ALTERNATE_MATOMO_URL?: string;
  readonly VITE_ALTERNATE_MATOMO_SITE_ID?: string;
  readonly VITE_ALTERNATE_MATOMO_SUBDOMAIN?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  _paq: any[]; //matomo
}
