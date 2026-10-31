"use client";
import { useRef, useState } from "react";
type Entry = { method: string; path: string; status: number; body: unknown };
export default function Playground() {
  const token = useRef(""),
    [session, setSession] = useState(""),
    [busy, setBusy] = useState(false),
    [entries, setEntries] = useState<Entry[]>([]),
    [message, setMessage] = useState("");
  async function call(
    method: string,
    path: string,
    body?: unknown,
    key?: string,
  ) {
    const r = await fetch("/api" + path, {
      method,
      headers: {
        ...(token.current ? { Authorization: "Bearer " + token.current } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const parsed: unknown = r.status === 204 ? {} : await r.json();
    const value =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    const safe =
      path === "/sandboxes" && r.status === 201
        ? {
            id: value.id,
            expires_at: value.expires_at,
            demo: value.demo,
            token: "[omitido: guardado só na memória desta página]",
          }
        : value;
    setEntries((old) => [
      ...old,
      { method, path, status: r.status, body: safe },
    ]);
    return { status: r.status, body: value };
  }
  async function run() {
    setBusy(true);
    setMessage("");
    setEntries([]);
    try {
      const s = await call("POST", "/sandboxes");
      if (
        s.status !== 201 ||
        typeof s.body.token !== "string" ||
        typeof s.body.id !== "string"
      )
        throw new Error(
          "A sandbox não pôde ser criada. Confira a resposta abaixo.",
        );
      token.current = s.body.token;
      setSession(s.body.id);
      const stock = await call("GET", "/products");
      if (stock.status !== 200)
        throw new Error("Não foi possível consultar o estoque.");
      const key = "roteiro-" + crypto.randomUUID();
      const body = { sku: "CAB-001", quantity: 7, ttl_seconds: 300 };
      const hold = await call("POST", "/reservations", body, key);
      if (hold.status !== 201 || typeof hold.body.id !== "string")
        throw new Error("Não foi possível criar a reserva.");
      const replay = await call("POST", "/reservations", body, key);
      if (replay.status !== 200 || replay.body.id !== hold.body.id)
        throw new Error("A verificação de idempotência falhou.");
      const conflict = await call(
        "POST",
        "/reservations",
        { ...body, quantity: 4 },
        "conflito-" + crypto.randomUUID(),
      );
      if (conflict.status !== 409)
        throw new Error("O conflito esperado não foi retornado.");
      const confirmed = await call(
        "POST",
        `/reservations/${hold.body.id}/confirm`,
      );
      if (confirmed.status !== 200) throw new Error("A confirmação falhou.");
      await call("GET", "/events");
      await call("GET", "/products");
      setMessage(
        "Roteiro concluído: reserva criada, repetição reconhecida, excesso recusado e confirmação persistida.",
      );
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Falha de conexão. Tente consultar o estado ou aguarde o serviço.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function consult() {
    setBusy(true);
    try {
      await call("GET", "/reservations");
      await call("GET", "/products");
    } catch {
      setMessage("Falha ao consultar a API. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }
  async function revoke() {
    setBusy(true);
    try {
      const r = await call("DELETE", "/sandboxes/current");
      if (r.status === 204 || r.status === 401) {
        token.current = "";
        setSession("");
        setMessage("Sandbox encerrada. O token deixou de funcionar.");
      } else
        setMessage("Não foi possível encerrar. Confira a resposta da API.");
    } catch {
      setMessage("Falha de conexão ao encerrar. A sandbox expira em 24 horas.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="demo-title" className="playground">
      <div className="section-title">
        <span>ROTEIRO EXECUTÁVEL</span>
        <h2 id="demo-title">Teste o back-end real.</h2>
      </div>
      <p>
        Cria uma sandbox isolada e executa oito chamadas HTTP contra o servidor.
        O estoque é sintético; as reservas, conflitos e gravações no banco são
        reais. Nenhuma compra ou cobrança acontece.
      </p>
      <div className="actions">
        <button onClick={run} disabled={busy || !!session}>
          {busy ? "Executando…" : "Executar roteiro"}
        </button>
        <button onClick={consult} disabled={busy || !session}>
          Consultar estado
        </button>
        <button onClick={revoke} disabled={busy || !session}>
          Encerrar sandbox e apagar seus dados
        </button>
      </div>
      <p className="fine">
        O token fica só na memória desta página e não aparece nos logs abaixo.
        Recarregar perde o acesso ao roteiro; a API continua guardando a sandbox
        até expirar. Para usar em outro cliente, crie um token pela documentação
        e guarde-o com cuidado.
      </p>
      <p role="status" className="status">
        {message}
      </p>
      {session && (
        <p className="session">
          Sandbox ativa: <code>{session}</code>
        </p>
      )}
      <ol className="results">
        {entries.map((e, i) => (
          <li key={i}>
            <div>
              <b>{e.method}</b>
              <code>{e.path}</code>
              <strong className={e.status < 300 ? "success" : "expected"}>
                HTTP {e.status}
              </strong>
            </div>
            <pre>{JSON.stringify(e.body, null, 2)}</pre>
          </li>
        ))}
      </ol>
    </section>
  );
}
