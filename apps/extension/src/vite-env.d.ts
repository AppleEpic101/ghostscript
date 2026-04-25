/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PAIRING_API_BASE_URL?: string;
  readonly VITE_GHOSTSCRIPT_DEPLOY_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
