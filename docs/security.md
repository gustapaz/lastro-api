# Segurança e limites da demonstração

- Token de 256 bits, hash no banco, expiração e revogação com exclusão em cascata.
- Autorização por sandbox, inclusive leitura e alteração por UUID.
- SQL parametrizado, constraints e operações atômicas de estoque.
- Validação estrita de quantidade, SKU, TTL, paginação e idempotência.
- Corpo limitado a 4 KiB e JSON obrigatório na criação de reserva.
- Origin de navegador restrito ao próprio serviço, sem CORS permissivo. Isso não substitui autenticação; clientes HTTP sem Origin são aceitos.
- Cotas persistidas atomicamente, com 429 e Retry-After.
- Respostas da API sem cache, nosniff, identificadores de requisição e erros sem stack traces ou segredos.
- Swagger sem persistência de autorização; o playground mantém token somente na memória da aba e mascara os logs.

O token é uma capacidade temporária: quem o possui controla aquele sandbox. Não use dados pessoais. Todos os produtos são sintéticos; não há cobrança, e-mail ou integração comercial.

Sandboxes expiram em 24 horas. O acesso expira nesse prazo; a exclusão física é oportunística ao criar novos sandboxes. Reservas pendentes duram entre 30 e 900 segundos. Existem limites de 20 sandboxes por hora UTC globalmente, 120 escritas por sandbox por hora UTC e 100 reservas por sandbox. A cota pública pode ser esgotada por terceiros; aguarde a próxima hora em caso de 429.

Não há proteção DDoS própria, SLA, recuperação de conta ou backup exportável. Os testes comprovam comportamentos específicos, não ausência universal de vulnerabilidades. Credenciais de publicação ficam fora do repositório.
