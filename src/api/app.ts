import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { Banco } from "../banco/db.ts";
import { criarServidorMcp, GUIA } from "../mcp/servidor.ts";
import {
  buscarConjuntos,
  consultar,
  descreverConjunto,
  descreverDominio,
  ErroConsulta,
  listarDominios,
  listarFontes,
  PROJETO,
} from "../servico.ts";
import { buscarConceitos, ontologiaJsonLd, ontologiaTurtle } from "../ontologia/ontologia.ts";
import { documentoOpenApi } from "./openapi.ts";
import { exigirHost, exigirOrigem, limitarTaxa, opcoesDoAmbiente, type OpcoesProtecao } from "./protecoes.ts";

const STATUS_POR_CODIGO: Record<string, 400 | 404 | 503> = {
  conjunto_invalido: 404,
  dominio_invalido: 404,
  nao_coletado: 503,
  tempo_esgotado: 503,
};

/** Corpo máximo de POST: uma consulta cabe em poucos KB. */
const LIMITE_CORPO = 64 * 1024;

function erro(c: Context, e: unknown) {
  if (e instanceof ErroConsulta) {
    return c.json(
      { erro: { codigo: e.codigo, mensagem: e.message, detalhes: e.detalhes } },
      STATUS_POR_CODIGO[e.codigo] ?? 400,
    );
  }
  console.error(e);
  return c.json({ erro: { codigo: "erro_interno", mensagem: "Erro interno." } }, 500);
}

export function criarApp(banco: Banco, protecao: OpcoesProtecao = opcoesDoAmbiente()): Hono {
  const app = new Hono();
  const cliente = (c: Context) => {
    if (protecao.confiarProxy) {
      const xff = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
      if (xff) return xff;
    }
    try { return getConnInfo(c).remote.address ?? "local"; } catch { return "local"; }
  };

  app.use("*", exigirHost(protecao.hostsPermitidos));
  app.use("*", secureHeaders({ crossOriginResourcePolicy: "cross-origin" }));
  // dados públicos e sem cookies: qualquer site pode ler a API; o /mcp tem regra própria
  app.use("*", cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["content-type", "accept", "mcp-protocol-version"],
    maxAge: 86400,
  }));
  app.use("*", limitarTaxa(protecao.limitePorMinuto, cliente));
  app.use("*", bodyLimit({
    maxSize: LIMITE_CORPO,
    onError: (c) => c.json({ erro: { codigo: "corpo_grande", mensagem: `Corpo acima de ${LIMITE_CORPO / 1024} KB.` } }, 413),
  }));
  app.use("/mcp", exigirOrigem(protecao.origensMcp));

  app.get("/", (c) =>
    c.json({
      ...PROJETO,
      links: {
        dominios: "/domains",
        busca: "/search?q=populacao",
        consulta: "POST /query",
        fontes: "/sources",
        guia_para_agentes: "/guide",
        ontologia: "/ontology (JSON-LD) · /ontology?formato=turtle · /ontology?q=perdas",
        openapi: "/openapi",
        mcp: "/mcp",
      },
    }),
  );
  app.get("/health", async (c) => {
    try {
      await banco.consultar("select 1");
      return c.json({ ok: true, versao: PROJETO.versao });
    } catch {
      return c.json({ ok: false }, 503);
    }
  });

  app.get("/domains", async (c) => {
    try { return c.json(await listarDominios(banco)); } catch (e) { return erro(c, e); }
  });
  app.get("/domains/:id", async (c) => {
    try { return c.json(await descreverDominio(banco, c.req.param("id"))); } catch (e) { return erro(c, e); }
  });
  app.get("/datasets/:id", async (c) => {
    try { return c.json(await descreverConjunto(banco, c.req.param("id"))); } catch (e) { return erro(c, e); }
  });
  app.get("/search", async (c) => {
    const q = c.req.query("q")?.trim();
    if (!q || q.length > 200) return c.json({ erro: { codigo: "consulta_invalida", mensagem: "Informe ?q=termo (até 200 caracteres)" } }, 400);
    try { return c.json(await buscarConjuntos(banco, q)); } catch (e) { return erro(c, e); }
  });
  app.get("/sources", async (c) => {
    try { return c.json(await listarFontes(banco)); } catch (e) { return erro(c, e); }
  });
  app.post("/query", async (c) => {
    let corpo: unknown;
    try {
      corpo = await c.req.json();
    } catch {
      return c.json({ erro: { codigo: "json_invalido", mensagem: "Corpo precisa ser JSON." } }, 400);
    }
    try { return c.json(await consultar(banco, corpo)); } catch (e) { return erro(c, e); }
  });

  app.get("/ontology", async (c) => {
    try {
      const q = c.req.query("q")?.trim().slice(0, 200);
      if (q) return c.json(await buscarConceitos(banco, q));
      if (c.req.query("formato") === "turtle" || c.req.header("accept")?.includes("text/turtle")) {
        return c.body(await ontologiaTurtle(banco), 200, { "content-type": "text/turtle; charset=utf-8" });
      }
      return c.body(JSON.stringify(await ontologiaJsonLd(banco), null, 2), 200, {
        "content-type": "application/ld+json; charset=utf-8",
      });
    } catch (e) { return erro(c, e); }
  });

  app.get("/guide", (c) => c.body(GUIA, 200, { "content-type": "text/markdown; charset=utf-8" }));
  app.get("/openapi", (c) => c.json(documentoOpenApi()));

  // Quem abre /mcp no navegador recebia o erro cru do protocolo ("Client must accept text/event-stream").
  // Navegador (pede HTML e não event-stream) ganha uma página dizendo o que é e como conectar.
  app.get("/mcp", async (c, next) => {
    const aceita = c.req.header("accept") ?? "";
    if (!aceita.includes("text/html") || aceita.includes("text/event-stream")) return next();
    const host = (c.req.header("host") ?? new URL(c.req.url).host).replace(/[^a-zA-Z0-9.:-]/g, "");
    const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(host);
    return c.html(paginaMcp(`${local ? "http" : "https"}://${host}/mcp`));
  });

  // MCP por HTTP, sem sessão: um servidor e um transporte por requisição.
  app.all("/mcp", async (c) => {
    const transporte = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const mcp = criarServidorMcp(banco);
    await mcp.connect(transporte);
    try {
      return await transporte.handleRequest(c.req.raw);
    } finally {
      void mcp.close();
    }
  });

  app.onError((e, c) => erro(c, e));
  app.notFound((c) => c.json({ erro: { codigo: "nao_encontrado", mensagem: "Rota inexistente. Veja /." } }, 404));
  return app;
}

/** Página para quem abre o endereço do MCP no navegador. */
function paginaMcp(url: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Brasil Dados Utilities · MCP</title>
<style>body{font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;max-width:720px;margin:48px auto;padding:0 16px;color:#13202e;background:#f6f8fb}
code,pre{font:14px/1.5 ui-monospace,Menlo,Consolas,monospace;background:#e9eef3;border-radius:6px}code{padding:2px 6px}pre{padding:12px 14px;overflow-x:auto}
h1{font-size:26px;margin:0 0 8px}a{color:#1559b8}small{color:#4d6176}</style></head><body>
<h1>Servidor MCP de dados públicos do Brasil</h1>
<p>Este endereço não é uma página: é a porta de conexão para assistentes de IA (Claude, Cursor, VS Code e outros clientes
<a href="https://modelcontextprotocol.io">MCP</a>) consultarem dados oficiais de saneamento, rios, território e energia
(SINISA, ANA, IBGE, SGB, ANEEL, ONS), sempre com a fonte e a data de cada número. Só leitura, sem cadastro.</p>
<p><b>Endereço:</b> <code>${url}</code></p>
<p><b>Claude Code:</b></p><pre>claude mcp add --transport http brasil-dados ${url}</pre>
<p><b>Claude (app), Cursor e outros:</b> adicione um servidor MCP remoto (HTTP) com o endereço acima.</p>
<p>Guia para agentes: <a href="/guide">/guide</a> · Código aberto (MIT):
<a href="https://github.com/infrabalance/brasil-dados-utilities">github.com/infrabalance/brasil-dados-utilities</a></p>
<p><small>Uso livre com limite por cliente. Criado e mantido por Balance.ia. — This is an MCP server endpoint, not a web page:
add it to your MCP client as a remote HTTP server.</small></p>
</body></html>`;
}
