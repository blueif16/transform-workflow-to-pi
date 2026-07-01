/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL for the piflow control server; "" = same-origin (dev proxy / local serve). */
  readonly VITE_PIFLOW_API?: string;
}

