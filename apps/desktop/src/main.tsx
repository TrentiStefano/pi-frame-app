import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./i18n/renderer";
import "./dev-reload-hook";
import "./styles.css";

document.documentElement.dataset.platform = window.piApp?.platform ?? "unknown";
document.documentElement.classList.toggle("dark", window.piApp?.initialResolvedTheme === "dark");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
