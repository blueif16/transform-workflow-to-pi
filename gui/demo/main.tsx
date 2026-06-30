// MUST be first: installs the static-demo data shim (window.fetch + EventSource over
// `/__piflow/*`) BEFORE any component module loads, so the published demo needs no server.
import "./demoFetch";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
