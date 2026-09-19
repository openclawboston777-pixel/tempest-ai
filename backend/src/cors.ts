import { config } from "./config.js";

// Single source of truth for the CORS allowlist decision, shared by the global
// @fastify/cors registration AND the streaming /chat route (which writes to
// reply.raw and therefore bypasses the plugin's header injection — it must set
// Access-Control-Allow-Origin itself or the browser blocks the SSE response).
//
// Rules mirror the original inline policy: wildcard "*" allows any well-formed
// origin; otherwise the origin must be https on the standard port and its host
// must match an allowlist entry (bare host, full origin, or "*.base" subdomain).
export function isOriginAllowed(origin: string | undefined | null): boolean {
  if (!origin) return false;
  if (config.corsOrigin.trim() === "*") return true;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  if (u.port && u.port !== "443") return false;
  const host = u.hostname.toLowerCase();
  return config.corsOrigin
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .some((entry) => {
      const e = entry.toLowerCase();
      if (e.startsWith("*.")) {
        const base = e.slice(2);
        return host === base || host.endsWith("." + base);
      }
      let eh = e;
      try {
        eh = new URL(e).hostname.toLowerCase();
      } catch {
        /* bare host entry */
      }
      return host === eh;
    });
}
