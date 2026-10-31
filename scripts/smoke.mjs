import assert from "node:assert/strict";
const base = process.argv[2];
if (!base || !/^https?:\/\//.test(base))
  throw new Error(
    "Use npm run smoke -- http://127.0.0.1:PORT ou a URL da sua demo.",
  );
let token = "";
async function call(path, method = "GET", body, key) {
  const r = await fetch(new URL("/api" + path, base), {
    method,
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = r.status === 204 ? null : await r.json();
  return { status: r.status, data };
}
const health = await call("/health");
assert.equal(health.status, 200);
assert.equal(health.data.database, "ok");
const s = await call("/sandboxes", "POST");
assert.equal(s.status, 201);
token = s.data.token;
try {
  const first = await call(
    "/reservations",
    "POST",
    { sku: "CAB-001", quantity: 7 },
    "smoke-order-001",
  );
  assert.equal(first.status, 201);
  const repeat = await call(
    "/reservations",
    "POST",
    { sku: "CAB-001", quantity: 7 },
    "smoke-order-001",
  );
  assert.equal(repeat.status, 200);
  assert.equal(repeat.data.id, first.data.id);
  assert.equal(
    (
      await call(
        "/reservations",
        "POST",
        { sku: "CAB-001", quantity: 4 },
        "smoke-order-002",
      )
    ).status,
    409,
  );
  assert.equal(
    (await call(`/reservations/${first.data.id}/confirm`, "POST")).status,
    200,
  );
  const read = await call("/reservations/" + first.data.id);
  assert.equal(read.data.status, "confirmed");
  const events = await call("/events");
  assert.deepEqual(
    events.data.items.map((e) => e.type),
    ["created", "confirmed"],
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        base: new URL(base).origin,
        checks: [
          "health+database",
          "create sandbox",
          "reserve",
          "idempotency",
          "stock conflict",
          "confirm",
          "read persisted",
          "atomic events",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  const revoked = await call("/sandboxes/current", "DELETE");
  assert.equal(revoked.status, 204);
  assert.equal((await call("/products")).status, 401);
  console.log("Sandbox sintética do smoke test revogada.");
}
