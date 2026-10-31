import { env } from "cloudflare:workers";
import { createApp } from "../../../server/app";
const app = createApp();
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  if (!env.DB)
    return new Response(
      JSON.stringify({ code: "database_unavailable", status: 503 }),
      { status: 503, headers: { "Content-Type": "application/problem+json" } },
    );
  return app.fetch(request, { DB: env.DB });
}
export {
  handle as GET,
  handle as POST,
  handle as DELETE,
  handle as OPTIONS,
  handle as PUT,
  handle as PATCH,
  handle as HEAD,
};
