import { ingestFeeds } from "./feeds/ingest";

export default {
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (request.method === "GET" && pathname === "/health") return Response.json({ ok: true });
    return new Response("Not found", { status: 404 });
  },

  // Awaited (not waitUntil) so a failed ingest marks the cron invocation as failed.
  async scheduled(_controller, env) {
    await ingestFeeds(env);
  },
} satisfies ExportedHandler<Env>;
