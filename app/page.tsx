import Playground from "./playground";
export default function Home() {
  return (
    <main>
      <header>
        <a className="brand" href="/">
          LASTRO<span>API / ESTOQUE SINTÉTICO</span>
        </a>
        <nav aria-label="Recursos">
          <a href="/docs.html">Documentação interativa ↗</a>
          <a href="/api/openapi.json">OpenAPI JSON ↗</a>
          <a
            href="https://github.com/gustapaz/lastro-api"
            target="_blank"
            rel="noreferrer"
          >
            GitHub ↗
          </a>
        </nav>
      </header>
      <section className="intro">
        <span className="eyebrow">BACK-END REAL · DEMONSTRAÇÃO PÚBLICA</span>
        <h1>
          Uma reserva.
          <br />
          Mesmo se o pedido chegar duas vezes.
        </h1>
        <p>
          Lastro é uma API de reservas de estoque que trabalha com idempotência,
          transições atômicas e isolamento por sandbox. Um projeto de back-end
          para estudar problemas que vão além de cadastrar e listar registros.
        </p>
        <div className="tech">
          <span>TypeScript</span>
          <span>Hono</span>
          <span>SQLite / D1</span>
          <span>OpenAPI</span>
        </div>
        <a href="/api/health" className="health">
          Consultar health e banco ↗
        </a>
      </section>
      <Playground />
      <section className="reference">
        <h2>O que acontece no servidor</h2>
        <dl>
          <div>
            <dt>01 / Idempotência</dt>
            <dd>
              A mesma chave e o mesmo payload retornam a reserva existente.
              Reusar a chave com outro payload retorna 409.
            </dd>
          </div>
          <div>
            <dt>02 / Concorrência</dt>
            <dd>
              A decisão de reservar e a inserção usam um único comando SQL
              atômico. Pedidos simultâneos não podem consumir mais estoque que o
              disponível.
            </dd>
          </div>
          <div>
            <dt>03 / Estados</dt>
            <dd>
              Held pode virar confirmed ou released. Reservas held expiradas
              deixam de consumir estoque; confirmed continua consumindo.
            </dd>
          </div>
          <div>
            <dt>04 / Eventos</dt>
            <dd>
              Triggers gravam os eventos de criação e transição na mesma
              transação. Não há fila ou webhook externo fingindo uma entrega.
            </dd>
          </div>
        </dl>
      </section>
      <section className="limits">
        <h2>Uma demo com limites claros.</h2>
        <p>
          Cada sandbox recebe três SKUs e expira em 24 horas. Até 100 reservas
          por sandbox, 120 escritas por hora por sandbox e 20 novas sandboxes
          por hora UTC para toda a demonstração. Ao atingir a cota, a API
          retorna 429; a disponibilidade também depende dos limites da
          hospedagem.
        </p>
        <p>
          Os tokens são aleatórios e seus hashes ficam no banco. Quem possui um
          token acessa somente sua sandbox. Não há senha, conta pessoal, pedidos
          reais, pagamento ou envio de e-mail. Sandboxes expiradas são removidas
          em limpezas oportunistas; a expiração não depende de cron.
        </p>
        <p>
          Persistência SQLite/D1 no servidor. O armazenamento do navegador não
          participa das regras de negócio. Isto é uma demonstração de portfólio,
          sem promessa de disponibilidade contínua ou certificação de segurança.
        </p>
      </section>
      <footer>
        <span>Lastro API · Gustavo Paz</span>
        <a
          href="https://github.com/gustapaz/lastro-api"
          target="_blank"
          rel="noreferrer"
        >
          Código, testes e execução local ↗
        </a>
      </footer>
    </main>
  );
}
