import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import type { Context } from "hono";
import {
  digest,
  newToken,
  fingerprint,
  present,
  seedProducts,
  type ReservationRow,
} from "./domain";
import {
  Reservation,
  CreateReservation,
  Id,
  List,
  EventQuery,
  Key,
  json,
  errors,
} from "./schemas";
export type Env = {
  Bindings: { DB: D1Database };
  Variables: { sandbox: { id: string; expires_at: number }; requestId: string };
};
const now = () => Math.floor(Date.now() / 1000);
function problem<
  S extends 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 503,
>(
  c: Context<Env>,
  status: S,
  code: string,
  title: string,
  details?: { path: string; message: string }[],
) {
  return c.json(
    {
      type: `urn:lastro:error:${code}`,
      title,
      status,
      code,
      request_id: c.get("requestId"),
      ...(details ? { details } : {}),
    },
    status,
    {
      "Content-Type": "application/problem+json",
      "Cache-Control": "no-store",
      "X-Request-Id": c.get("requestId"),
    },
  );
}
async function quota(
  db: D1Database,
  key: string,
  limit: number,
  until: number,
) {
  const v = await db
    .prepare(
      "INSERT INTO quotas (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count < ? RETURNING count",
    )
    .bind(key, until, limit)
    .first();
  return !!v;
}
async function getReservation(c: Context<Env>, id: string) {
  return c.env.DB.prepare(
    "SELECT * FROM reservations WHERE id=? AND sandbox_id=?",
  )
    .bind(id, c.get("sandbox").id)
    .first<ReservationRow>();
}
export function createApp() {
  const app = new OpenAPIHono<Env>({
    defaultHook: (r, c) => {
      if (!r.success)
        return problem(
          c,
          422,
          "validation_error",
          "Confira os parâmetros enviados.",
          r.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        );
    },
  });
  app.use("*", async (c, next) => {
    c.set("requestId", crypto.randomUUID());
    c.header("X-Request-Id", c.get("requestId"));
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    const origin = c.req.header("Origin");
    if (origin && origin !== new URL(c.req.url).origin)
      return problem(
        c,
        403,
        "origin_not_allowed",
        "Esta origem não está autorizada. Use um cliente HTTP ou a documentação na mesma origem.",
      );
    await next();
  });
  app.use(
    "*",
    bodyLimit({
      maxSize: 4096,
      onError: (c) =>
        problem(c, 413, "body_too_large", "O limite do corpo é 4096 bytes."),
    }),
  );
  app.use("*", async (c, next) => {
    if (
      c.req.method === "POST" &&
      /\/reservations$/.test(c.req.path) &&
      !c.req
        .header("Content-Type")
        ?.toLowerCase()
        .startsWith("application/json")
    )
      return problem(
        c,
        415,
        "unsupported_media_type",
        "Envie application/json.",
      );
    await next();
  });
  app.onError((e, c) => {
    if (e instanceof HTTPException && e.status === 400)
      return problem(c, 400, "invalid_json", "O corpo JSON não pôde ser lido.");
    console.error(
      JSON.stringify({
        request_id: c.get("requestId"),
        code: "service_unavailable",
      }),
    );
    return problem(
      c,
      503,
      "service_unavailable",
      "Não foi possível acessar o serviço. Tente novamente.",
    );
  });
  app.notFound((c) => problem(c, 404, "not_found", "Endpoint não encontrado."));
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/health",
      tags: ["Operação"],
      summary: "Verificar processo e banco",
      responses: {
        200: {
          description: "Servidor e banco disponíveis.",
          ...json(
            z.object({
              status: z.literal("ok"),
              service: z.literal("lastro-api"),
              database: z.literal("ok"),
            }),
          ),
        },
        503: errors[503],
      },
    }),
    async (c) => {
      await c.env.DB.prepare("SELECT 1 AS ok").first();
      return c.json(
        {
          status: "ok" as const,
          service: "lastro-api" as const,
          database: "ok" as const,
        },
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/sandboxes",
      tags: ["Sandbox"],
      summary: "Criar área isolada de demonstração",
      description:
        "Cria três produtos sintéticos e um token Bearer aleatório de 256 bits, mostrado uma vez. Expira em 24 horas. Cota global: 20 criações por hora UTC; sem dados pessoais.",
      responses: {
        201: {
          description:
            "Sandbox criada. Guarde o token; não pode ser recuperado.",
          ...json(
            z.object({
              id: z.string().uuid(),
              token: z.string(),
              expires_at: z.string().datetime(),
              demo: z.literal(true),
            }),
          ),
        },
        429: errors[429],
        503: errors[503],
      },
    }),
    async (c) => {
      const time = now(),
        bucket = Math.floor(time / 3600);
      if (
        !(await quota(c.env.DB, `create:${bucket}`, 20, (bucket + 1) * 3600))
      ) {
        c.header("Retry-After", String((bucket + 1) * 3600 - time));
        return problem(
          c,
          429,
          "creation_limit",
          "A cota pública de criação foi atingida. Tente na próxima hora UTC.",
        );
      }
      await c.env.DB.batch([
        c.env.DB.prepare(
          "DELETE FROM sandboxes WHERE id IN (SELECT id FROM sandboxes WHERE expires_at<=? LIMIT 100)",
        ).bind(time),
        c.env.DB.prepare(
          "DELETE FROM quotas WHERE key IN (SELECT key FROM quotas WHERE expires_at<=? LIMIT 100)",
        ).bind(time),
      ]);
      const id = crypto.randomUUID(),
        token = newToken(),
        expiry = time + 86400,
        hash = await digest(token);
      await c.env.DB.batch([
        c.env.DB.prepare(
          "INSERT INTO sandboxes(id,token_hash,created_at,expires_at) VALUES (?,?,?,?)",
        ).bind(id, hash, time, expiry),
        ...seedProducts.map((p) =>
          c.env.DB.prepare(
            "INSERT INTO products(sandbox_id,sku,name,stock) VALUES (?,?,?,?)",
          ).bind(id, p.sku, p.name, p.stock),
        ),
      ]);
      return c.json(
        {
          id,
          token,
          expires_at: new Date(expiry * 1000).toISOString(),
          demo: true as const,
        },
        201,
      );
    },
  );
  app.use("/api/*", async (c, next) => {
    if (
      c.req.path === "/api/openapi.json" ||
      c.req.path === "/api/health" ||
      (c.req.path === "/api/sandboxes" && c.req.method === "POST")
    )
      return next();
    const authorization = c.req.header("Authorization") || "";
    if (!/^Bearer ls_[A-Za-z0-9_-]{43}$/.test(authorization))
      return problem(c, 401, "unauthorized", "Envie um token Bearer válido.");
    const sandbox = await c.env.DB.prepare(
      "SELECT id,expires_at FROM sandboxes WHERE token_hash=? AND expires_at>?",
    )
      .bind(await digest(authorization.slice(7)), now())
      .first<{ id: string; expires_at: number }>();
    if (!sandbox)
      return problem(
        c,
        401,
        "unauthorized",
        "Token inválido, expirado ou revogado.",
      );
    c.set("sandbox", sandbox);
    if (!["GET", "HEAD"].includes(c.req.method)) {
      const t = now(),
        bucket = Math.floor(t / 3600);
      if (
        !(await quota(
          c.env.DB,
          `write:${sandbox.id}:${bucket}`,
          120,
          (bucket + 1) * 3600,
        ))
      ) {
        c.header("Retry-After", String((bucket + 1) * 3600 - t));
        return problem(
          c,
          429,
          "write_limit",
          "A sandbox atingiu 120 operações de escrita nesta hora UTC.",
        );
      }
    }
    await next();
  });
  const security = [{ Bearer: [] }];
  app.openapi(
    createRoute({
      method: "delete",
      path: "/api/sandboxes/current",
      tags: ["Sandbox"],
      security,
      summary: "Revogar token e apagar somente esta sandbox",
      responses: {
        204: { description: "Token revogado e dados sintéticos removidos." },
        401: errors[401],
        429: errors[429],
        503: errors[503],
      },
    }),
    async (c) => {
      const id = c.get("sandbox").id;
      await c.env.DB.batch([
        c.env.DB.prepare("DELETE FROM sandboxes WHERE id=?").bind(id),
        c.env.DB.prepare("DELETE FROM quotas WHERE key LIKE ?").bind(
          `write:${id}:%`,
        ),
      ]);
      return c.body(null, 204);
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/products",
      tags: ["Estoque"],
      security,
      summary: "Consultar estoque da sandbox",
      description:
        "Reservas held válidas e confirmações consomem disponibilidade. Reservas expiradas e liberadas não consomem. Nenhum estoque global é compartilhado entre visitantes.",
      responses: {
        200: {
          description: "Estoque atual.",
          ...json(
            z.object({
              items: z.array(
                z.object({
                  sku: z.string(),
                  name: z.string(),
                  stock: z.number().int(),
                  committed: z.number().int(),
                  available: z.number().int(),
                }),
              ),
            }),
          ),
        },
        401: errors[401],
        503: errors[503],
      },
    }),
    async (c) => {
      const rows = await c.env.DB.prepare(
        `SELECT p.sku,p.name,p.stock,COALESCE((SELECT SUM(r.quantity) FROM reservations r WHERE r.sandbox_id=p.sandbox_id AND r.sku=p.sku AND (r.status='confirmed' OR (r.status='held' AND r.expires_at>unixepoch()))),0) AS committed FROM products p WHERE p.sandbox_id=? ORDER BY p.sku`,
      )
        .bind(c.get("sandbox").id)
        .all<{ sku: string; name: string; stock: number; committed: number }>();
      return c.json(
        {
          items: rows.results.map((p) => ({
            ...p,
            available: p.stock - p.committed,
          })),
        },
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/reservations",
      tags: ["Reservas"],
      security,
      summary: "Reservar estoque de forma atômica",
      description:
        "Idempotency-Key é obrigatória por sandbox. Mesma chave e payload retornam a reserva existente (200), no seu estado atual; chave com outro payload retorna 409. Falhas não consomem a chave. Até 100 reservas por sandbox.",
      request: {
        headers: Key,
        body: {
          required: true,
          content: { "application/json": { schema: CreateReservation } },
        },
      },
      responses: {
        201: {
          description: "Reserva criada e evento gravado atomicamente.",
          ...json(Reservation),
        },
        200: {
          description: "Repetição idempotente; mesma reserva no estado atual.",
          ...json(Reservation),
        },
        ...errors,
      },
    }),
    async (c) => {
      const { sku, quantity, ttl_seconds } = c.req.valid("json"),
        key = c.req.valid("header")["Idempotency-Key"],
        sid = c.get("sandbox").id,
        time = now(),
        hash = await fingerprint(sku, quantity, ttl_seconds),
        id = crypto.randomUUID();
      const existing = await c.env.DB.prepare(
        "SELECT * FROM reservations WHERE sandbox_id=? AND idempotency_key=?",
      )
        .bind(sid, key)
        .first<ReservationRow>();
      if (existing) {
        if (existing.request_hash !== hash)
          return problem(
            c,
            409,
            "idempotency_conflict",
            "Esta chave já foi usada com outro payload.",
          );
        c.header("Idempotency-Replayed", "true");
        return c.json(present(existing, time), 200);
      }
      const inserted = await c.env.DB.prepare(
        `INSERT INTO reservations(id,sandbox_id,sku,quantity,status,idempotency_key,request_hash,created_at,expires_at) SELECT ?,p.sandbox_id,p.sku,?,'held',?,?,unixepoch(),unixepoch()+? FROM products p WHERE p.sandbox_id=? AND p.sku=? AND p.stock-COALESCE((SELECT SUM(r.quantity) FROM reservations r WHERE r.sandbox_id=p.sandbox_id AND r.sku=p.sku AND (r.status='confirmed' OR (r.status='held' AND r.expires_at>unixepoch()))),0)>=? AND (SELECT COUNT(*) FROM reservations WHERE sandbox_id=?)<100 ON CONFLICT(sandbox_id,idempotency_key) DO NOTHING RETURNING *`,
      )
        .bind(id, quantity, key, hash, ttl_seconds, sid, sku, quantity, sid)
        .first<ReservationRow>();
      if (inserted) return c.json(present(inserted, time), 201);
      const replay = await c.env.DB.prepare(
        "SELECT * FROM reservations WHERE sandbox_id=? AND idempotency_key=?",
      )
        .bind(sid, key)
        .first<ReservationRow>();
      if (replay) {
        if (replay.request_hash !== hash)
          return problem(
            c,
            409,
            "idempotency_conflict",
            "Esta chave já foi usada com outro payload.",
          );
        c.header("Idempotency-Replayed", "true");
        return c.json(present(replay, time), 200);
      }
      const p = await c.env.DB.prepare(
        "SELECT sku FROM products WHERE sandbox_id=? AND sku=?",
      )
        .bind(sid, sku)
        .first();
      if (!p)
        return problem(
          c,
          404,
          "product_not_found",
          "SKU não encontrado nesta sandbox.",
        );
      const count = await c.env.DB.prepare(
        "SELECT COUNT(*) AS n FROM reservations WHERE sandbox_id=?",
      )
        .bind(sid)
        .first<{ n: number }>();
      if (count!.n >= 100)
        return problem(
          c,
          409,
          "sandbox_full",
          "A sandbox atingiu o limite de 100 reservas.",
        );
      return problem(
        c,
        409,
        "insufficient_stock",
        "Quantidade indisponível. Nenhuma reserva foi criada.",
      );
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/reservations",
      tags: ["Reservas"],
      security,
      summary: "Listar reservas com paginação e filtro",
      request: { query: List },
      responses: {
        200: {
          description: "Página de reservas.",
          ...json(
            z.object({
              items: z.array(Reservation),
              limit: z.number(),
              offset: z.number(),
            }),
          ),
        },
        401: errors[401],
        422: errors[422],
        503: errors[503],
      },
    }),
    async (c) => {
      const { limit, offset, status } = c.req.valid("query"),
        time = now();
      const rows = await c.env.DB.prepare(
        `SELECT * FROM reservations WHERE sandbox_id=? AND (? IS NULL OR CASE WHEN status='held' AND expires_at<=? THEN 'expired' ELSE status END=?) ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`,
      )
        .bind(
          c.get("sandbox").id,
          status || null,
          time,
          status || null,
          limit,
          offset,
        )
        .all<ReservationRow>();
      return c.json(
        { items: rows.results.map((r) => present(r, time)), limit, offset },
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/reservations/{id}",
      tags: ["Reservas"],
      security,
      summary: "Consultar uma reserva da própria sandbox",
      request: { params: Id },
      responses: {
        200: { description: "Reserva atual.", ...json(Reservation) },
        401: errors[401],
        404: errors[404],
        422: errors[422],
        503: errors[503],
      },
    }),
    async (c) => {
      const row = await getReservation(c, c.req.valid("param").id);
      return row
        ? c.json(present(row, now()), 200)
        : problem(c, 404, "not_found", "Reserva não encontrada nesta sandbox.");
    },
  );
  for (const action of ["confirm", "release"] as const) {
    app.openapi(
      createRoute({
        method: "post",
        path: `/api/reservations/{id}/${action}`,
        tags: ["Reservas"],
        security,
        summary:
          action === "confirm"
            ? "Confirmar uma reserva válida"
            : "Liberar uma reserva válida",
        description:
          "Transição atômica; repetir a mesma transição bem-sucedida retorna 200 sem duplicar eventos. Estado expirado ou transição incompatível retorna 409.",
        request: { params: Id },
        responses: {
          200: {
            description: "Reserva no estado solicitado.",
            ...json(Reservation),
          },
          401: errors[401],
          404: errors[404],
          409: errors[409],
          422: errors[422],
          429: errors[429],
          503: errors[503],
        },
      }),
      async (c) => {
        const time = now(),
          id = c.req.valid("param").id,
          target = action === "confirm" ? "confirmed" : "released";
        const updated = await c.env.DB.prepare(
          `UPDATE reservations SET status=? WHERE id=? AND sandbox_id=? AND status='held' AND expires_at>unixepoch() RETURNING *`,
        )
          .bind(target, id, c.get("sandbox").id)
          .first<ReservationRow>();
        if (updated) return c.json(present(updated, time), 200);
        const row = await getReservation(c, id);
        if (!row)
          return problem(
            c,
            404,
            "not_found",
            "Reserva não encontrada nesta sandbox.",
          );
        if (row.status === target) return c.json(present(row, time), 200);
        return problem(
          c,
          409,
          "invalid_transition",
          "A reserva expirou ou está em estado incompatível com esta operação.",
        );
      },
    );
  }
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/events",
      tags: ["Eventos"],
      security,
      summary: "Ler eventos de negócio da sandbox",
      description:
        "Eventos created, confirmed e released são gerados por triggers na mesma transação. Expiração é derivada do relógio e não gera evento persistido. Cursor after é exclusivo.",
      request: { query: EventQuery },
      responses: {
        200: {
          description: "Eventos em ordem de criação.",
          ...json(
            z.object({
              items: z.array(
                z.object({
                  id: z.number().int(),
                  reservation_id: z.string().uuid(),
                  type: z.enum(["created", "confirmed", "released"]),
                  at: z.string().datetime(),
                }),
              ),
              next_after: z.number().int(),
            }),
          ),
        },
        401: errors[401],
        422: errors[422],
        503: errors[503],
      },
    }),
    async (c) => {
      const { after, limit } = c.req.valid("query");
      const rows = await c.env.DB.prepare(
        "SELECT id,reservation_id,type,at FROM events WHERE sandbox_id=? AND id>? ORDER BY id LIMIT ?",
      )
        .bind(c.get("sandbox").id, after, limit)
        .all<{
          id: number;
          reservation_id: string;
          type: "created" | "confirmed" | "released";
          at: number;
        }>();
      return c.json(
        {
          items: rows.results.map((e) => ({
            ...e,
            at: new Date(e.at * 1000).toISOString(),
          })),
          next_after: rows.results.at(-1)?.id ?? after,
        },
        200,
      );
    },
  );
  app.openAPIRegistry.registerComponent("securitySchemes", "Bearer", {
    type: "http",
    scheme: "bearer",
    description:
      "Token temporário obtido em POST /api/sandboxes. Cada token só acessa sua sandbox.",
  });
  app.doc("/api/openapi.json", {
    openapi: "3.0.3",
    info: {
      title: "Lastro API",
      version: "1.0.0",
      description:
        "Reservas reais sobre estoque sintético. API demonstrativa com SQLite/D1, idempotência, transições atômicas e isolamento por token. Sandboxes expiram em 24h e são removidas em limpezas oportunistas. Sem pedidos, cobranças ou mensagens externas.",
    },
    servers: [{ url: "/" }],
  });
  return app;
}
