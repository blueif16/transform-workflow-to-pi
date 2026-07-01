// Base URL for the piflow control server. "" = same-origin (dev proxy / local serve).
// Set VITE_PIFLOW_API to point the built GUI at a remote (cloud) serve endpoint.
export const API_BASE = (import.meta.env.VITE_PIFLOW_API ?? "").replace(/\/$/, "");
export const api = (p: string) => `${API_BASE}${p}`;
export const sse = (p: string) => new EventSource(api(p));
