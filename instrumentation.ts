import { parseEnv } from "./lib/env";

// Runs once when a server instance starts; a throw here stops it.
export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") parseEnv(process.env);
}
