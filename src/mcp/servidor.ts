import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Banco } from "../banco/db.ts";
import { AVISO_CONTEUDO } from "../seguranca/texto.ts";
import { Consulta } from "../consulta/schema.ts";
import { buscarConceitos, ontologiaJsonLd } from "../ontologia/ontologia.ts";
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

export const GUIA = readFileSync(new URL("../../docs/guia-agentes.md", import.meta.url), "utf8");

type Resultado = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

/**
 * Resposta padrão das ferramentas: JSON em texto (todo cliente lê) e o mesmo
 * objeto em structuredContent (clientes novos usam sem reparsear). Erros de
 * uso voltam com isError e mensagem acionável; erros internos não vazam detalhe.
 */
async function responder(fn: () => Promise<unknown>, chaveLista = "itens"): Promise<Resultado> {
  try {
    const r = await fn();
    const objeto = Array.isArray(r) ? { [chaveLista]: r } : (r as Record<string, unknown>);
    return { content: [{ type: "text", text: JSON.stringify(objeto, null, 2) }], structuredContent: objeto };
  } catch (e) {
    let erro: Record<string, unknown>;
    if (e instanceof ErroConsulta) {
      erro = { codigo: e.codigo, mensagem: e.message, detalhes: e.detalhes };
    } else {
      console.error(e); // stderr: no stdio, o stdout é do protocolo
      erro = { codigo: "erro_interno", mensagem: "Erro interno do servidor." };
    }
    return { content: [{ type: "text", text: JSON.stringify({ erro }, null, 2) }], isError: true };
  }
}

/** Só leitura, sem efeitos, mesma resposta para a mesma entrada, sobre um banco local (não a web aberta). */
const SO_LEITURA = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const termo = z.string().trim().min(1).max(200);
const identificador = z.string().trim().min(1).max(100).regex(/^[a-z_.]+$/, "use o id, ex.: territorio.municipios");

export function criarServidorMcp(banco: Banco): McpServer {
  const mcp = new McpServer(
    { name: "brasil-dados-utilities", version: PROJETO.versao },
    {
      instructions:
        `${PROJETO.descricao} Criado e mantido por Balance.ia. ` +
        "Comece por listar_dominios ou buscar; leia descrever_conjunto antes de consultar; cite sempre a fonte e a data de referência. " +
        "Para traduzir termos do setor (ex.: 'perdas de água', 'SAIDI') use a ferramenta conceitos. O guia completo está no resource guia://agentes. " +
        `${AVISO_CONTEUDO} Não apresente dado sem a fonte; se a proveniência ou os avisos indicarem defasagem ou lacuna, diga isso ao usuário.`,
    },
  );

  mcp.registerTool(
    "listar_dominios",
    {
      title: "Listar domínios e conjuntos",
      description: "Lista os domínios (energia, água, saneamento, território) e seus conjuntos de dados, com data da última coleta.",
      annotations: SO_LEITURA,
    },
    () => responder(() => listarDominios(banco), "dominios"),
  );

  mcp.registerTool(
    "descrever_dominio",
    {
      title: "Descrever domínio",
      description: "Detalha um domínio e todos os seus conjuntos (campos, avisos, exemplos).",
      inputSchema: { dominio: identificador.describe("Id do domínio, ex.: territorio") },
      annotations: SO_LEITURA,
    },
    ({ dominio }) => responder(() => descreverDominio(banco, dominio)),
  );

  mcp.registerTool(
    "descrever_conjunto",
    {
      title: "Descrever conjunto",
      description:
        "Campos, unidades, campo de tempo, avisos, exemplos de consulta e proveniência de um conjunto. Leia antes de consultar.",
      inputSchema: { conjunto: identificador.describe("Id do conjunto, ex.: territorio.municipios") },
      annotations: SO_LEITURA,
    },
    ({ conjunto }) => responder(() => descreverConjunto(banco, conjunto)),
  );

  mcp.registerTool(
    "buscar",
    {
      title: "Buscar conjuntos por conceito",
      description: 'Acha conjuntos por termo, ex.: "população", "DEC", "perda de água", "reservatório".',
      inputSchema: { termo: termo.describe("Termo em português ou inglês") },
      annotations: SO_LEITURA,
    },
    ({ termo }) => responder(() => buscarConjuntos(banco, termo)),
  );

  mcp.registerTool(
    "consultar",
    {
      title: "Consultar dados",
      description:
        "Consulta um conjunto com filtros, campos, período, ordenação e paginação. A resposta traz dados, total, proveniência (fonte, licença, data de referência) e avisos.",
      inputSchema: Consulta,
      annotations: SO_LEITURA,
    },
    (args) => responder(async () => ({ ...(await consultar(banco, args)), aviso_conteudo: AVISO_CONTEUDO })),
  );

  mcp.registerTool(
    "conceitos",
    {
      title: "Conceitos do setor (ontologia)",
      description:
        'Traduz um termo do setor para onde o dado está: ex. "perdas de água" → saneamento.indicadores com indicador IAG2013; "SAIDI" → DEC em energia.continuidade. Inclui definição, sinônimos (pt/en) e chave de junção.',
      inputSchema: { termo: termo.describe("Termo em português ou inglês") },
      annotations: SO_LEITURA,
    },
    ({ termo }) => responder(() => buscarConceitos(banco, termo)),
  );

  mcp.registerTool(
    "fontes",
    {
      title: "Fontes e coletas",
      description: "Fontes oficiais usadas, licenças, atribuição exigida e quando cada conjunto foi coletado.",
      annotations: SO_LEITURA,
    },
    () => responder(() => listarFontes(banco)),
  );

  mcp.registerResource(
    "guia",
    "guia://agentes",
    { title: "Guia para agentes", description: "Fluxo, formato de consulta, regras e receitas.", mimeType: "text/markdown" },
    (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: GUIA }] }),
  );

  mcp.registerResource(
    "ontologia",
    "ontologia://setor",
    { title: "Ontologia do setor (JSON-LD)", description: "Conceitos de água, energia e território, ligações e onde estão nos dados.", mimeType: "application/ld+json" },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/ld+json", text: JSON.stringify(await ontologiaJsonLd(banco), null, 2) }],
    }),
  );

  return mcp;
}
