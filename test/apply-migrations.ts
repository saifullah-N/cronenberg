import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Setup files run outside per-test storage isolation and may run more than once;
// applyD1Migrations() skips migrations that are already applied.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
