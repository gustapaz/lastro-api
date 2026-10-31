export type ReservationRow = {
  id: string;
  sandbox_id: string;
  sku: string;
  quantity: number;
  status: "held" | "confirmed" | "released";
  idempotency_key: string;
  request_hash: string;
  created_at: number;
  expires_at: number;
};
export const seedProducts = [
  { sku: "CAB-001", name: "Cabo USB-C demonstrativo", stock: 10 },
  { sku: "SUP-002", name: "Suporte de mesa demonstrativo", stock: 6 },
  { sku: "HUB-003", name: "Hub demonstrativo", stock: 4 },
];
export function state(
  row: ReservationRow,
  now: number,
): ReservationRow["status"] | "expired" {
  return row.status === "held" && row.expires_at <= now
    ? "expired"
    : row.status;
}
export function present(row: ReservationRow, now: number) {
  return {
    id: row.id,
    sku: row.sku,
    quantity: row.quantity,
    status: state(row, now),
    created_at: new Date(row.created_at * 1000).toISOString(),
    expires_at: new Date(row.expires_at * 1000).toISOString(),
  };
}
export async function digest(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  )
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return (
    "ls_" +
    btoa(String.fromCharCode(...bytes))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "")
  );
}
export function fingerprint(sku: string, quantity: number, ttl: number) {
  return digest(JSON.stringify([sku, quantity, ttl]));
}
