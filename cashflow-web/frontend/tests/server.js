// tests/server.js — the single shared MSW server instance + its default
// handlers. Kept in its own module so it is imported ONLY by the jsdom tests
// (via tests/setup.js's conditional dynamic import, and by the DOM test files
// that call `server.use(...)`). The node-environment `api-client.abort.test.js`
// must never load MSW from the shared setup — it owns its own server — so this
// module is deliberately NOT imported unconditionally by setup.js.
import { setupServer } from "msw/node";
import { handlers } from "./handlers";

export const server = setupServer(...handlers);
