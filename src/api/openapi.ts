import { z } from "zod";
import { Consulta } from "../consulta/schema.ts";
import { CONJUNTOS } from "../dominios/catalogo.ts";
import { PROJETO } from "../servico.ts";

const json = (schema?: object) => ({
  description: "OK",
  content: { "application/json": { schema: schema ?? { type: "object" } } },
});
const Erro = {
  type: "object",
  properties: {
    erro: {
      type: "object",
      properties: { codigo: { type: "string" }, mensagem: { type: "string" }, detalhes: { type: "object" } },
      required: ["codigo", "mensagem"],
    },
  },
};

export function documentoOpenApi() {
  const consulta = z.toJSONSchema(Consulta, { io: "input" }) as Record<string, unknown>;
  delete consulta.$schema;
  (consulta.properties as Record<string, Record<string, unknown>>).conjunto!.enum = [...CONJUNTOS.keys()];

  return {
    openapi: "3.1.0",
    info: {
      title: PROJETO.nome,
      version: PROJETO.versao,
      description: `${PROJETO.descricao}\n\nCriado e mantido por [Balance.ia](${PROJETO.criado_por.url}). ${PROJETO.aviso}`,
      license: { name: "MIT (código). Dados: licença de cada fonte — veja /sources", identifier: "MIT" },
    },
    paths: {
      "/domains": { get: { summary: "Lista domínios e conjuntos", responses: { 200: json() } } },
      "/domains/{id}": {
        get: {
          summary: "Detalha um domínio",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: json(), 404: json(Erro) },
        },
      },
      "/datasets/{id}": {
        get: {
          summary: "Detalha um conjunto (campos, avisos, exemplos, proveniência)",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", enum: [...CONJUNTOS.keys()] } }],
          responses: { 200: json(), 404: json(Erro) },
        },
      },
      "/search": {
        get: {
          summary: "Busca conjuntos por conceito",
          parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" } }],
          responses: { 200: json() },
        },
      },
      "/query": {
        post: {
          summary: "Consulta um conjunto",
          requestBody: { required: true, content: { "application/json": { schema: consulta } } },
          responses: { 200: json(), 400: json(Erro), 404: json(Erro), 503: json(Erro) },
        },
      },
      "/sources": { get: { summary: "Fontes, licenças e coletas", responses: { 200: json() } } },
      "/ontology": {
        get: {
          summary: "Ontologia do setor (JSON-LD; ?formato=turtle; ?q=termo para achar conceitos e onde estão)",
          parameters: [
            { name: "q", in: "query", required: false, schema: { type: "string" } },
            { name: "formato", in: "query", required: false, schema: { type: "string", enum: ["jsonld", "turtle"] } },
          ],
          responses: { 200: { description: "OK", content: { "application/ld+json": { schema: { type: "object" } }, "text/turtle": { schema: { type: "string" } } } } },
        },
      },
      "/guide": {
        get: {
          summary: "Guia para agentes (markdown, use como system prompt)",
          responses: { 200: { description: "OK", content: { "text/markdown": { schema: { type: "string" } } } } },
        },
      },
      "/mcp": { post: { summary: "Servidor MCP (Streamable HTTP, sem sessão)", responses: { 200: json() } } },
    },
  };
}
