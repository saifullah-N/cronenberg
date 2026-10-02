// Optional settings that aren't in wrangler.jsonc `vars`, so `wrangler types` doesn't emit them.
// PHISHTANK_ENABLED ("true" to opt in) can be set as a var; PHISHTANK_APP_KEY is a secret.
interface Env {
  PHISHTANK_ENABLED?: string;
  PHISHTANK_APP_KEY?: string;
}

declare namespace Cloudflare {
  interface Env {
    PHISHTANK_ENABLED?: string;
    PHISHTANK_APP_KEY?: string;
  }
}
