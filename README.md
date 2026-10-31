# Lastro API

Reservas de estoque com idempotência, concorrência e persistência real. TypeScript, Hono, SQLite/D1 e OpenAPI.

[Demo e API](https://lastro-api-gustapaz.starrylinen.chatgpt.site) | [Swagger UI](https://lastro-api-gustapaz.starrylinen.chatgpt.site/docs.html) | [OpenAPI](https://lastro-api-gustapaz.starrylinen.chatgpt.site/api/openapi.json)

## Recursos

- Sandboxes isolados com token temporário e três produtos sintéticos.
- Reserva, confirmação, liberação e expiração automática da disponibilidade.
- Idempotência por chave e fingerprint, estoque verificado atomicamente sob concorrência.
- Eventos transacionais por triggers, com rollback se a auditoria falhar.
- Paginação, filtros, cursor de eventos, revogação e health check com banco real.

Produtos são sintéticos. Autorização, regras e persistência são reais. Não há pagamentos, e-mails ou integrações comerciais.

## Executar localmente

Node.js 24 e npm. Não exige conta de cloud, Docker, cartão ou segredo.

```sh
npm ci
npm run build
npm run db:migrate
npm start -- --port 5199
```

Abra http://127.0.0.1:5199 e http://127.0.0.1:5199/docs.html. A migração atua somente no D1 local, em `.wrangler/state`, sem apagar dados existentes. O seed é criado por sandbox.

```sh
npm run check
npm run typecheck
npm test
npm run smoke -- http://127.0.0.1:5199
```

Os 23 testes usam SQLite real no Miniflare. Cobrem isolamento, autorização, validação, limites, concorrência, idempotência, transições, expiração, rollback e reabertura do banco. O smoke executa HTTP real e revoga somente o sandbox que criou. A CI instala do lockfile, verifica formatação e tipos, testa e compila.

## API

Crie um sandbox com `POST /api/sandboxes`. O token é mostrado uma vez. Envie `Authorization: Bearer <token>` nos endpoints privados; na Swagger UI use Authorize. Não coloque tokens em URLs ou no Git.

`GET /api/products` mostra disponibilidade. `POST /api/reservations` recebe JSON como `{"sku":"CAB-001","quantity":7,"ttl_seconds":300}` e exige o header `Idempotency-Key: exemplo-0001`.

Repetir chave e corpo retorna a mesma reserva. Outro corpo com a mesma chave retorna 409. Use o id em `POST /api/reservations/{id}/confirm` ou `/release`. Confirmar 7 unidades de CAB-001 deixa 3 disponíveis; reservar outras 4 retorna 409. `DELETE /api/sandboxes/current` revoga o token e remove seus dados.

O contrato OpenAPI detalha schemas, respostas e filtros. Erros usam application/problem+json e identificador de requisição, sem stack trace.

## Arquitetura e hospedagem

[Decisões e invariantes](docs/architecture.md) | [Proteções e limites](docs/security.md)

Hono concentra regras e SQL; Vinext encaminha HTTP ao Worker. O playground é somente um cliente técnico; o token fica na memória da aba.

A demo usa a hospedagem integrada Sites, com Worker e D1. Nenhum cartão, faturamento ou plano pago foi ativado para o projeto. GitHub hospeda código e CI; GitHub Pages não executa a API. Disponibilidade e cotas dependem do serviço, sem promessa de gratuidade permanente ou SLA.

Sandboxes expiram em 24 horas; o acesso expira nesse prazo e a remoção física é oportunística. Reservas pendentes duram 30 a 900 segundos. Limites: 20 sandboxes/hora UTC globalmente, 120 escritas/sandbox/hora UTC, 100 reservas/sandbox e corpo de 4 KiB. A cota pública pode ser esgotada por terceiros; aguarde a próxima hora em caso de 429. Use somente dados sintéticos.

A publicação usa `.openai/hosting.json`, migrações e build do Worker. Credenciais ficam fora do Git. Mudanças de schema exigem uma nova migração.

## Licença

MIT para código do projeto. Dependências mantêm suas licenças. Swagger UI conserva LICENSE e NOTICE em public/swagger; tooling Sites/Vinext conserva avisos em vendor e scripts/vite/sites-vite-plugin.LICENSE.
