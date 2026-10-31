# Arquitetura

Lastro explora reservas de estoque sob concorrência, idempotência e auditoria transacional. TypeScript e Hono atendem HTTP; SQLite/D1 é a fonte de verdade. O adaptador Vinext fornece o binding do Worker e a página técnica.

- `server/domain.ts`: tokens, fingerprints e apresentação de estados.
- `server/schemas.ts`: validação e contrato OpenAPI.
- `server/app.ts`: autorização, regras e consultas parametrizadas.
- `db/schema.ts` e `drizzle/`: schema, constraints, índices e migrações.
- `tests/api.test.ts`: integração com SQLite real no Miniflare.
- `scripts/smoke.mjs`: cenário HTTP contra um servidor em execução.

## Invariantes

A disponibilidade é o estoque inicial menos reservas confirmadas e pendentes ainda válidas. A criação usa `INSERT ... SELECT ... WHERE`, verificando o estoque dentro da mesma instrução SQL. A unicidade por sandbox e chave de idempotência resolve repetições concorrentes. O fingerprint impede reutilizar a chave com outro payload.

Confirmação e liberação usam atualização condicional e o relógio do banco. Repetir o mesmo destino é idempotente; transições conflitantes ou expiradas retornam 409. A expiração libera disponibilidade pela consulta, sem cron.

Triggers registram eventos na mesma transação da reserva. Se o evento falha, a operação inteira é revertida. A expiração é um estado derivado, sem evento agendado.

Todas as consultas de negócio incluem o sandbox autenticado. Tokens aleatórios de 256 bits são mostrados uma vez; somente o hash SHA-256 fica no banco. Não há recuperação de token nem contas pessoais.

## Persistência

Localmente, o banco permanece em `.wrangler/state` entre reinícios. Os testes comprovam reabertura do banco. Na hospedagem, o binding D1 mantém os dados entre requisições e deploys, dentro da retenção do sandbox. O health check consulta o banco real.

Migrações versionadas são aplicadas na publicação. O comando local usa explicitamente `--local`. Não edite migrações aplicadas: gere uma nova migração.
