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
