import React from "react";
import ReactDOM from "react-dom/client";

// Design system — single source of truth for colors, type, and the
// Cairo/Tajawal font @import. Imported once at the app root.
import "./styles/colors_and_type.css";

import App from "./App.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
