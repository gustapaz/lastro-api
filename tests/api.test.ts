import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { Miniflare } from "miniflare";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep, basename } from "node:path";
import { createApp } from "../server/app";
import { digest } from "../server/domain";
import { Reservation } from "../server/schemas";
let mf: Miniflare, db: D1Database, directory: string;
const app = createApp();
function runtime() {
  return new Miniflare({
    modules: true,
    script: 'export default { fetch(){return new Response("test");}}',
    compatibilityDate: "2026-05-15",
    d1Databases: { DB: "lastro-test" },
    d1Persist: directory,
  });
}
async function request(
  path: string,
  token?: string,
  method = "GET",
  body?: unknown,
  key = "test-order-001",
) {
  return app.request(
    "https://lastro.test/api" + path,
    {
      method,
      headers: {
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(body !== undefined
          ? { "Content-Type": "application/json", "Idempotency-Key": key }
          : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
    { DB: db },
  );
}
async function sandbox() {
  const r = await request("/sandboxes", undefined, "POST");
  expect(r.status).toBe(201);
  return (await r.json()) as { id: string; token: string; expires_at: string };
}
async function reserve(
  token: string,
  quantity = 3,
  key = "test-order-001",
  sku = "CAB-001",
) {
  return request(
    "/reservations",
    token,
    "POST",
    { sku, quantity, ttl_seconds: 300 },
    key,
  );
}
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "lastro-integration-"));
  mf = runtime();
  db = (await mf.getD1Database("DB")) as unknown as D1Database;
  const migration = await readFile(
    new URL("../drizzle/0000_broad_champions.sql", import.meta.url),
    "utf8",
  );
  for (const sql of migration
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean))
    await db.prepare(sql).run();
});
beforeEach(async () => {
  await db.prepare("DELETE FROM sandboxes").run();
  await db.prepare("DELETE FROM quotas").run();
});
afterAll(async () => {
  await mf?.dispose();
  if (directory) {
    if (
      !resolve(directory).startsWith(resolve(tmpdir()) + sep) ||
      !basename(directory).startsWith("lastro-integration-")
    )
      throw new Error("Unsafe test cleanup path");
    await rm(directory, { recursive: true, force: true });
  }
});
describe("contrato, autenticação e limites", () => {
  it("health usa o banco real e OpenAPI descreve as operações", async () => {
    const r = await request("/health");
    expect(await r.json()).toEqual({
      status: "ok",
      service: "lastro-api",
      database: "ok",
    });
    const spec = (await (await request("/openapi.json")).json()) as {
      paths: Record<string, unknown>;
    };
    expect(spec.paths["/api/reservations"]).toBeDefined();
    expect(spec.paths["/api/reservations/{id}/confirm"]).toBeDefined();
  });
  it("não grava token bruto, expõe só uma vez e isola dados", async () => {
    const a = await sandbox(),
      b = await sandbox();
    const row = await db
      .prepare("SELECT token_hash FROM sandboxes WHERE id=?")
      .bind(a.id)
      .first<{ token_hash: string }>();
    expect(row!.token_hash).toBe(await digest(a.token));
    expect(row!.token_hash).not.toBe(a.token);
    const made = await reserve(a.token);
    const hold = (await made.json()) as { id: string };
    expect((await request("/reservations/" + hold.id, b.token)).status).toBe(
      404,
    );
    expect(
      (await request("/reservations/" + hold.id + "/confirm", b.token, "POST"))
        .status,
    ).toBe(404);
    expect((await request("/events", b.token)).status).toBe(200);
    const events = (await (await request("/events", b.token)).json()) as {
      items: unknown[];
    };
    expect(events.items).toEqual([]);
  });
  it("nega acesso sem token, com token falso e expirado", async () => {
    expect((await request("/products")).status).toBe(401);
    expect((await request("/products", "ls_" + "x".repeat(43))).status).toBe(
      401,
    );
    const s = await sandbox();
    await db
      .prepare("UPDATE sandboxes SET expires_at=0 WHERE id=?")
      .bind(s.id)
      .run();
    expect((await request("/products", s.token)).status).toBe(401);
  });
  it("revoga somente a própria sandbox e apaga seus dados em cascata", async () => {
    const a = await sandbox(),
      b = await sandbox();
    await reserve(a.token);
    const r = await request("/sandboxes/current", a.token, "DELETE");
    expect(r.status).toBe(204);
    expect((await request("/products", a.token)).status).toBe(401);
    expect((await request("/products", b.token)).status).toBe(200);
    const count = await db
      .prepare("SELECT COUNT(*) AS n FROM events WHERE sandbox_id=?")
      .bind(a.id)
      .first<{ n: number }>();
    expect(count!.n).toBe(0);
  });
  it.each([0, -1, 1.5, 101, "3"])(
    "rejeita quantidade inválida %s",
    async (quantity) => {
      const s = await sandbox();
      const r = await request("/reservations", s.token, "POST", {
        sku: "CAB-001",
        quantity,
      });
      expect(r.status).toBe(422);
      expect(r.headers.get("content-type")).toContain(
        "application/problem+json",
      );
    },
  );
  it("rejeita chave ausente, campos extras e JSON quebrado", async () => {
    const s = await sandbox();
    let r = await app.request(
      "https://lastro.test/api/reservations",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + s.token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sku: "CAB-001", quantity: 1 }),
      },
      { DB: db },
    );
    expect(r.status).toBe(422);
    r = await request("/reservations", s.token, "POST", {
      sku: "CAB-001",
      quantity: 1,
      admin: true,
    });
    expect(r.status).toBe(422);
    r = await app.request(
      "https://lastro.test/api/reservations",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + s.token,
          "Content-Type": "application/json",
          "Idempotency-Key": "broken-json",
        },
        body: "{bad",
      },
      { DB: db },
    );
    expect(r.status).toBe(400);
  });
  it("rejeita tipo incorreto, corpo grande e origem externa", async () => {
    let r = await app.request(
      "https://lastro.test/api/reservations",
      { method: "POST", body: "text" },
      { DB: db },
    );
    expect(r.status).toBe(415);
    r = await app.request(
      "https://lastro.test/api/reservations",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "x".repeat(5000) }),
      },
      { DB: db },
    );
    expect(r.status).toBe(413);
    r = await app.request(
      "https://lastro.test/api/sandboxes",
      { method: "POST", headers: { Origin: "https://other.test" } },
      { DB: db },
    );
    expect(r.status).toBe(403);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
  it("respeita cotas globais e por sandbox com Retry-After", async () => {
    const t = Math.floor(Date.now() / 3600000);
    await db
      .prepare("INSERT INTO quotas(key,count,expires_at) VALUES (?,20,?)")
      .bind("create:" + t, (t + 1) * 3600)
      .run();
    let r = await request("/sandboxes", undefined, "POST");
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("Retry-After"))).toBeGreaterThan(0);
    await db.prepare("DELETE FROM quotas").run();
    const s = await sandbox();
    await db
      .prepare("INSERT INTO quotas(key,count,expires_at) VALUES (?,120,?)")
      .bind(`write:${s.id}:${t}`, (t + 1) * 3600)
      .run();
    r = await reserve(s.token);
    expect(r.status).toBe(429);
    expect((await request("/products", s.token)).status).toBe(200);
  });
});
describe("reservas e atomicidade", () => {
  it("cria, repete sem duplicar e impede conflito de payload", async () => {
    const s = await sandbox();
    const first = await reserve(s.token),
      a = await first.json();
    expect(first.status).toBe(201);
    expect(Reservation.safeParse(a).success).toBe(true);
    const replay = await reserve(s.token);
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await replay.json()).toEqual(a);
    expect((await reserve(s.token, 4)).status).toBe(409);
    const events = (await (await request("/events", s.token)).json()) as {
      items: unknown[];
    };
    expect(events.items.length).toBe(1);
  });
  it("duas chamadas simultâneas com mesma chave geram uma reserva", async () => {
    const s = await sandbox();
    const results = await Promise.all([
      reserve(s.token, 3),
      reserve(s.token, 3),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    const [a, b] = await Promise.all(
      results.map((r) => r.json() as Promise<{ id: string }>),
    );
    expect(a.id).toBe(b.id);
    const count = await db
      .prepare("SELECT COUNT(*) AS n FROM reservations WHERE sandbox_id=?")
      .bind(s.id)
      .first<{ n: number }>();
    expect(count!.n).toBe(1);
  });
  it("pedidos concorrentes não ultrapassam o estoque", async () => {
    const s = await sandbox();
    const results = await Promise.all([
      reserve(s.token, 7, "concurrent-001"),
      reserve(s.token, 7, "concurrent-002"),
      reserve(s.token, 7, "concurrent-003"),
    ]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    const body = (await (await request("/products", s.token)).json()) as {
      items: { sku: string; available: number }[];
    };
    expect(body.items.find((p) => p.sku === "CAB-001")!.available).toBe(3);
  });
  it("SKU desconhecido e estoque insuficiente não criam evento", async () => {
    const s = await sandbox();
    expect((await reserve(s.token, 1, "unknown-sku", "XYZ-999")).status).toBe(
      404,
    );
    expect((await reserve(s.token, 11, "stock-error")).status).toBe(409);
    const data = (await (await request("/events", s.token)).json()) as {
      items: unknown[];
    };
    expect(data.items).toEqual([]);
  });
  it("libera estoque e repetir liberação não duplica evento", async () => {
    const s = await sandbox();
    const a = (await (await reserve(s.token, 10)).json()) as { id: string };
    expect((await reserve(s.token, 1, "another-key")).status).toBe(409);
    expect(
      (await request(`/reservations/${a.id}/release`, s.token, "POST")).status,
    ).toBe(200);
    expect(
      (await request(`/reservations/${a.id}/release`, s.token, "POST")).status,
    ).toBe(200);
    expect((await reserve(s.token, 10, "another-key")).status).toBe(201);
    const ev = (await (await request("/events", s.token)).json()) as {
      items: { type: string }[];
    };
    expect(ev.items.map((e) => e.type)).toEqual([
      "created",
      "released",
      "created",
    ]);
  });
  it("confirma uma vez; confirmação não vira liberação", async () => {
    const s = await sandbox();
    const a = (await (await reserve(s.token, 10)).json()) as { id: string };
    const results = await Promise.all([
      request(`/reservations/${a.id}/confirm`, s.token, "POST"),
      request(`/reservations/${a.id}/confirm`, s.token, "POST"),
    ]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(
      (await request(`/reservations/${a.id}/release`, s.token, "POST")).status,
    ).toBe(409);
    expect((await reserve(s.token, 1, "another-order")).status).toBe(409);
    const ev = (await (await request("/events", s.token)).json()) as {
      items: unknown[];
    };
    expect(ev.items.length).toBe(2);
  });
  it("confirmar e liberar simultaneamente produzem uma única transição", async () => {
    const s = await sandbox();
    const a = (await (await reserve(s.token)).json()) as { id: string };
    const results = await Promise.all([
      request(`/reservations/${a.id}/confirm`, s.token, "POST"),
      request(`/reservations/${a.id}/release`, s.token, "POST"),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const ev = (await (await request("/events", s.token)).json()) as {
      items: unknown[];
    };
    expect(ev.items.length).toBe(2);
  });
  it("expiração devolve disponibilidade sem exigir cron", async () => {
    const s = await sandbox();
    const a = (await (await reserve(s.token, 10)).json()) as { id: string };
    await db
      .prepare("UPDATE reservations SET expires_at=0 WHERE id=?")
      .bind(a.id)
      .run();
    const r = (await (
      await request("/reservations/" + a.id, s.token)
    ).json()) as { status: string };
    expect(r.status).toBe("expired");
    expect(
      (await request(`/reservations/${a.id}/confirm`, s.token, "POST")).status,
    ).toBe(409);
    expect((await reserve(s.token, 10, "after-expiry")).status).toBe(201);
    const list = (await (
      await request("/reservations?status=expired", s.token)
    ).json()) as { items: { id: string }[] };
    expect(list.items.map((r) => r.id)).toEqual([a.id]);
  });
  it("falha na gravação do evento reverte a reserva", async () => {
    const s = await sandbox();
    await db
      .prepare(
        "CREATE TRIGGER fail_event BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'injected failure'); END",
      )
      .run();
    try {
      expect((await reserve(s.token)).status).toBe(503);
      const rows = await db
        .prepare("SELECT COUNT(*) AS n FROM reservations WHERE sandbox_id=?")
        .bind(s.id)
        .first<{ n: number }>();
      expect(rows!.n).toBe(0);
    } finally {
      await db.prepare("DROP TRIGGER fail_event").run();
    }
    expect((await reserve(s.token, 10)).status).toBe(201);
  });
  it("paginação e cursor não repetem resultados", async () => {
    const s = await sandbox();
    await reserve(s.token, 1, "page-first");
    await reserve(s.token, 1, "page-second");
    const a = (await (
      await request("/reservations?limit=1", s.token)
    ).json()) as { items: { id: string }[] };
    const b = (await (
      await request("/reservations?limit=1&offset=1", s.token)
    ).json()) as { items: { id: string }[] };
    expect(a.items[0].id).not.toBe(b.items[0].id);
    const ev = (await (await request("/events?limit=1", s.token)).json()) as {
      items: { id: number }[];
      next_after: number;
    };
    const next = (await (
      await request("/events?after=" + ev.next_after, s.token)
    ).json()) as { items: { id: number }[] };
    expect(next.items[0].id).toBeGreaterThan(ev.items[0].id);
  });
  it("persiste depois de reiniciar o runtime SQLite", async () => {
    const s = await sandbox();
    const made = (await (await reserve(s.token)).json()) as { id: string };
    await mf.dispose();
    mf = runtime();
    db = (await mf.getD1Database("DB")) as unknown as D1Database;
    const anotherApp = createApp();
    const r = await anotherApp.request(
      "https://lastro.test/api/reservations/" + made.id,
      { headers: { Authorization: "Bearer " + s.token } },
      { DB: db },
    );
    expect(r.status).toBe(200);
    expect(((await r.json()) as { id: string }).id).toBe(made.id);
  });
});
