import { z } from "@hono/zod-openapi";
export const Reservation = z
  .object({
    id: z.string().uuid(),
    sku: z.string(),
    quantity: z.number().int(),
    status: z.enum(["held", "confirmed", "released", "expired"]),
    created_at: z.string().datetime(),
    expires_at: z.string().datetime(),
  })
  .openapi("Reservation");
export const Problem = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    code: z.string(),
    request_id: z.string(),
    details: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional(),
  })
  .openapi("Problem");
export const CreateReservation = z
  .object({
    sku: z
      .string()
      .regex(/^[A-Z]{3}-\d{3}$/)
      .openapi({ example: "CAB-001" }),
    quantity: z.number().int().min(1).max(100).openapi({ example: 3 }),
    ttl_seconds: z
      .number()
      .int()
      .min(30)
      .max(900)
      .default(300)
      .openapi({ example: 300 }),
  })
  .strict()
  .openapi("CreateReservation");
export const Id = z.object({ id: z.string().uuid() });
export const List = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(500).default(0),
  status: z.enum(["held", "confirmed", "released", "expired"]).optional(),
});
export const EventQuery = z.object({
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const Key = z.object({
  "Idempotency-Key": z
    .string()
    .min(8)
    .max(80)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .openapi({ example: "pedido-demo-001" }),
});
export const json = <T extends z.ZodType>(schema: T) => ({
  content: { "application/json": { schema } },
});
export const errors = {
  401: {
    description: "Token ausente, inválido, revogado ou expirado.",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "Recurso não encontrado nesta sandbox.",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description: "Conflito de estoque, estado, chave ou limite da sandbox.",
    content: { "application/problem+json": { schema: Problem } },
  },
  413: {
    description: "Corpo maior que 4096 bytes.",
    content: { "application/problem+json": { schema: Problem } },
  },
  415: {
    description: "Envie application/json.",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description: "Parâmetros inválidos.",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Cota de demonstração atingida.",
    content: { "application/problem+json": { schema: Problem } },
  },
  503: {
    description: "Banco temporariamente indisponível.",
    content: { "application/problem+json": { schema: Problem } },
  },
};
