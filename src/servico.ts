/**
 * Camada única usada pela API HTTP e pelo MCP — as duas interfaces
 * respondem exatamente a mesma coisa.
 */
import { lerProveniencias, type Banco, type Proveniencia } from "./banco/db.ts";
import { acharConjunto, acharDominio, buscar, CONJUNTOS, DOMINIOS } from "./dominios/catalogo.ts";
import type { Conjunto, Fonte } from "./dominios/tipos.ts";
import { executarConsulta } from "./consulta/executar.ts";
import { ErroConsulta } from "./consulta/sql.ts";

export const PROJETO = {
  nome: "Brasil Dados Utilities",
  versao: "0.1.0",
  descricao: "API + MCP de dados públicos de água e energia do Brasil, pronta para agentes.",
  criado_por: { nome: "Balance.ia", url: "https://balance.ia.br" },
  licenca_codigo: "MIT",
  aviso: "Projeto independente. Não é afiliado a nenhuma das fontes. Cada dado mantém a licença da sua fonte.",
};

async function provPorConjunto(banco: Banco): Promise<Map<string, Proveniencia>> {
  return new Map((await lerProveniencias(banco)).map((p) => [p.conjunto, p]));
}

function resumoConjunto(c: Conjunto, prov?: Proveniencia) {
  return {
    id: c.id,
    titulo: c.titulo,
    descricao: c.descricao,
    fonte: c.fonte.nome,
    frequencia: c.frequencia,
    disponivel: Boolean(prov),
    coletado_em: prov?.coletado_em ?? null,
    data_referencia: prov?.data_referencia ?? null,
  };
}

export async function listarDominios(banco: Banco) {
  const prov = await provPorConjunto(banco);
  return DOMINIOS.map((d) => ({
    id: d.id,
    titulo: d.titulo,
    setor: d.setor,
    descricao: d.descricao,
    conjuntos: d.conjuntos.map((c) => resumoConjunto(c, prov.get(c.id))),
  }));
}

export async function descreverDominio(banco: Banco, id: string) {
  const d = acharDominio(id);
  if (!d) {
    throw new ErroConsulta(`Domínio "${id}" não existe.`, "dominio_invalido", {
      dominios_validos: DOMINIOS.map((x) => x.id),
    });
  }
  const prov = await provPorConjunto(banco);
  return { ...d, conjuntos: d.conjuntos.map((c) => descreverConjuntoCom(c, prov.get(c.id))) };
}

function descreverConjuntoCom(c: Conjunto, prov?: Proveniencia) {
  return {
    id: c.id,
    dominio: c.dominio,
    titulo: c.titulo,
    descricao: c.descricao,
    fonte: c.fonte,
    frequencia: c.frequencia,
    campo_tempo: c.campoTempo ?? null,
    chave: c.chave,
    campos: c.campos.map((f) => ({
      ...f,
      filtravel: f.tipo !== "geometria" && f.filtravel !== false,
      padrao: f.padrao ?? f.tipo !== "geometria",
    })),
    avisos: c.avisos ?? [],
    exemplos: c.exemplos,
    proveniencia: prov ?? null,
  };
}

export async function descreverConjunto(banco: Banco, id: string) {
  const c = acharConjunto(id);
  if (!c) {
    throw new ErroConsulta(`Conjunto "${id}" não existe.`, "conjunto_invalido", {
      conjuntos_validos: [...CONJUNTOS.keys()],
    });
  }
  return descreverConjuntoCom(c, (await provPorConjunto(banco)).get(c.id));
}

export async function buscarConjuntos(banco: Banco, termo: string) {
  const prov = await provPorConjunto(banco);
  return buscar(termo).map(({ conjunto, pontos }) => ({ ...resumoConjunto(conjunto, prov.get(conjunto.id)), relevancia: pontos }));
}

export async function listarFontes(banco: Banco) {
  const fontes = new Map<string, Fonte>();
  for (const c of CONJUNTOS.values()) fontes.set(c.fonte.id, c.fonte);
  return {
    fontes: [...fontes.values()],
    coletas: await lerProveniencias(banco),
  };
}

export { executarConsulta as consultar, ErroConsulta };
