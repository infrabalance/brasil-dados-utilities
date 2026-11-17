import { beforeAll, describe, expect, it } from "vitest";
import { criarApp as criarAppReal } from "../src/api/app.ts";
import type { OpcoesProtecao } from "../src/api/protecoes.ts";
import { substituirTabela } from "../src/banco/carga.ts";
import { Banco, registrarProveniencia } from "../src/banco/db.ts";
import { executarConsulta } from "../src/consulta/executar.ts";
import { ErroConsulta, montarSql } from "../src/consulta/sql.ts";
import { Consulta } from "../src/consulta/schema.ts";
import { CONJUNTOS } from "../src/dominios/catalogo.ts";

let banco: Banco;

const PROTECAO_TESTE: OpcoesProtecao = { limitePorMinuto: 0, origensMcp: [], hostsPermitidos: [], confiarProxy: false };
const criarApp = (b: Banco) => criarAppReal(b, PROTECAO_TESTE);

const MUNICIPIOS = [
  { codigo_ibge: "4205407", nome: "Florianópolis", uf: "SC", populacao_2022: 537211 },
  { codigo_ibge: "4209102", nome: "Joinville", uf: "SC", populacao_2022: 616317 },
  { codigo_ibge: "4216602", nome: "São José", uf: "SC", populacao_2022: 270299 },
  { codigo_ibge: "3549904", nome: "São José dos Campos", uf: "SP", populacao_2022: 697054 },
  { codigo_ibge: "5101837", nome: "Boa Esperança do Norte", uf: "MT", populacao_2022: null },
];

beforeAll(async () => {
  banco = await Banco.abrir(":memory:");
  await substituirTabela(
    banco,
    "territorio_municipios",
    {
      codigo_ibge: "VARCHAR", nome: "VARCHAR", uf: "VARCHAR", uf_nome: "VARCHAR", codigo_uf: "VARCHAR",
      regiao: "VARCHAR", regiao_nome: "VARCHAR", regiao_imediata: "VARCHAR", regiao_intermediaria: "VARCHAR",
      populacao_2022: "BIGINT",
    },
    MUNICIPIOS,
  );
  await registrarProveniencia(banco, {
    conjunto: "territorio.municipios", fonte: "IBGE", url_origem: "teste", licenca: "teste",
    data_referencia: "Censo 2022", linhas: MUNICIPIOS.length, observacao: null,
  });
});

const consultar = (q: object) => executarConsulta(banco, q);
const codigoDoErro = async (q: object) => {
  try {
    await consultar(q);
    return "sem erro";
  } catch (e) {
    return e instanceof ErroConsulta ? e.codigo : `outro: ${e}`;
  }
};

describe("consulta", () => {
  it("filtra por igualdade e operador, ordena e devolve número (não string)", async () => {
    const r = await consultar({
      conjunto: "territorio.municipios",
      campos: ["nome", "populacao_2022"],
      filtros: { uf: "SC", populacao_2022: { op: "gte", valor: 300000 } },
      ordenar: [{ campo: "populacao_2022", direcao: "desc" }],
    });
    expect(r.dados).toEqual([
      { nome: "Joinville", populacao_2022: 616317 },
      { nome: "Florianópolis", populacao_2022: 537211 },
    ]);
    expect(r.total).toBe(2);
    expect(r.proveniencia.atribuicao).toBe("Fonte: IBGE");
  });

  it("lista vira IN", async () => {
    const r = await consultar({ conjunto: "territorio.municipios", campos: ["uf"], filtros: { uf: ["SP", "MT"] } });
    expect(r.total).toBe(2);
  });

  it("contem ignora acento e maiúscula", async () => {
    const r = await consultar({
      conjunto: "territorio.municipios", campos: ["nome"], filtros: { nome: { op: "contem", valor: "SAO JOSE" } },
    });
    expect(r.dados.map((d) => d.nome).sort()).toEqual(["São José", "São José dos Campos"]);
  });

  it("nulos vão para o fim na ordenação", async () => {
    const r = await consultar({ conjunto: "territorio.municipios", campos: ["nome"], ordenar: [{ campo: "populacao_2022", direcao: "desc" }] });
    expect(r.dados.at(-1)?.nome).toBe("Boa Esperança do Norte");
  });

  it("avisa quando o resultado é paginado", async () => {
    const r = await consultar({ conjunto: "territorio.municipios", limite: 2 });
    expect(r.dados).toHaveLength(2);
    expect(r.total).toBe(5);
    expect(r.avisos.some((a) => a.includes("paginado"))).toBe(true);
  });

  it("texto malicioso em valor é só parâmetro", async () => {
    const r = await consultar({
      conjunto: "territorio.municipios", filtros: { nome: "x' or '1'='1" },
    });
    expect(r.total).toBe(0);
  });

  it.each([
    [{ conjunto: "nao.existe" }, "conjunto_invalido"],
    [{ conjunto: "territorio.municipios", campos: ['nome" from x; --'] }, "campo_invalido"],
    [{ conjunto: "territorio.municipios", filtros: { "1=1 or nome": "x" } }, "campo_invalido"],
    [{ conjunto: "territorio.municipios", ordenar: [{ campo: "senha", direcao: "asc" }] }, "campo_invalido"],
    [{ conjunto: "territorio.municipios", limite: 10_000 }, "consulta_invalida"],
    [{ conjunto: "territorio.municipios", extra: 1 }, "consulta_invalida"],
    [{ conjunto: "territorio.municipios", inicio: "2020" }, "sem_tempo"],
    [{ conjunto: "territorio.municipios", filtros: { nome: { op: "gt", valor: ["a", "b"] } } }, "filtro_invalido"],
    [{ conjunto: "territorio.ufs" }, "nao_coletado"],
  ])("rejeita %j com %s", async (q, codigo) => {
    expect(await codigoDoErro(q)).toBe(codigo);
  });
});

describe("API HTTP", () => {
  it("POST /query responde 200 com dados", async () => {
    const app = criarApp(banco);
    const r = await app.request("/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conjunto: "territorio.municipios", filtros: { uf: "MT" } }),
    });
    expect(r.status).toBe(200);
    expect((await r.json()).total).toBe(1);
  });

  it("conjunto não coletado responde 503", async () => {
    const r = await criarApp(banco).request("/query", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conjunto: "territorio.ufs" }),
    });
    expect(r.status).toBe(503);
  });

  it("/domains mostra o que está disponível", async () => {
    const r = await (await criarApp(banco).request("/domains")).json();
    const conj = r[0].conjuntos as { id: string; disponivel: boolean }[];
    expect(conj.find((c) => c.id === "territorio.municipios")?.disponivel).toBe(true);
    expect(conj.find((c) => c.id === "territorio.ufs")?.disponivel).toBe(false);
  });

  it("/openapi é 3.1 e lista os conjuntos", async () => {
    const d = await (await criarApp(banco).request("/openapi")).json();
    expect(d.openapi).toBe("3.1.0");
    expect(d.paths["/query"].post.requestBody.content["application/json"].schema.properties.conjunto.enum).toContain(
      "territorio.municipios",
    );
  });

  it("valor do tipo errado no filtro dá erro de uso com dica, não erro interno", () => {
    const c = CONJUNTOS.get("saneamento.indicadores")!;
    expect(() => montarSql(c, Consulta.parse({ conjunto: c.id, filtros: { capital: true } }))).toThrow(/texto: use o valor como texto/);
    expect(() => montarSql(c, Consulta.parse({ conjunto: c.id, filtros: { capital: "Sim" } }))).not.toThrow();
    expect(() => montarSql(c, Consulta.parse({ conjunto: c.id, filtros: { ano: "dois mil" } }))).toThrow(/numérico/);
  });
});
