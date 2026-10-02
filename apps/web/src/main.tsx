import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// StrictMode is intentionally off: drei's <Html> labels log spurious unmount warnings under the double-mount.
createRoot(document.getElementById("root")!).render(<App />);
