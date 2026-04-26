/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PAIRING_API_BASE_URL?: string;
  readonly VITE_GHOSTSCRIPT_DEPLOY_TOKEN?: string;
  readonly VITE_GHOSTSCRIPT_LLM_BASE_URL?: string;
  readonly VITE_GHOSTSCRIPT_LLM_API_KEY?: string;
  readonly VITE_GHOSTSCRIPT_LLM_MODEL?: string;
  readonly VITE_GHOSTSCRIPT_LLM_TOKENIZER?: string;
  readonly VITE_GHOSTSCRIPT_BITS_PER_STEP?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
