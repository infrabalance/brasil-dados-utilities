import type { DuckDBValue } from "@duckdb/node-api";
import type { Conjunto } from "../dominios/tipos.ts";
import type { ConsultaValidada } from "./schema.ts";

export class ErroConsulta extends Error {
  constructor(
    message: string,
    readonly codigo: string,
    readonly detalhes?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export interface SqlMontado {
  sql: string;
  sqlTotal: string;
  params: DuckDBValue[];
  paramsTotal: DuckDBValue[];
  /** A consulta usa funções da extensão spatial. */
  espacial: boolean;
}

/** Nome da coluna calculada quando a consulta usa `perto`. */
export const CAMPO_DISTANCIA = "distancia_km";

/** Só nomes vindos do catálogo chegam aqui; as aspas são cinto e suspensório. */
const id = (nome: string) => `"${nome.replaceAll('"', '""')}"`;

/**
 * Monta o SQL a partir da consulta validada. Nenhum texto do usuário entra
 * no SQL: campos e tabela vêm do catálogo, valores vão como parâmetros.
 */
export function montarSql(c: Conjunto, q: ConsultaValidada): SqlMontado {
  const nomes = new Set(c.campos.map((f) => f.nome));
  const exigirCampo = (nome: string, uso: string) => {
    if (!nomes.has(nome)) {
      throw new ErroConsulta(`Campo "${nome}" não existe em ${c.id} (${uso}).`, "campo_invalido", {
        campo: nome,
        campos_validos: [...nomes],
      });
    }
  };

  const ehGeo = (nome: string) => c.campos.find((f) => f.nome === nome)?.tipo === "geometria";
  // geometria é pesada: só vem quando pedida explicitamente
  const campos = q.campos ?? c.campos.filter((f) => f.padrao ?? f.tipo !== "geometria").map((f) => f.nome);
  campos.forEach((f) => exigirCampo(f, "campos"));

  const where: string[] = [];
  const params: DuckDBValue[] = [];
  const selectExtra: string[] = [];
  const paramsSelect: DuckDBValue[] = [];
  let espacial = false;

  if (q.perto) {
    const temCoord = ["latitude", "longitude"].every((n) => c.campos.some((f) => f.nome === n && f.tipo === "decimal"));
    if (!temCoord) {
      throw new ErroConsulta(`${c.id} não tem latitude/longitude; não use "perto".`, "sem_coordenadas");
    }
    // distância de grande círculo (haversine), em km
    const dist = `(6371.0088 * 2 * asin(sqrt(power(sin(radians(("latitude" - ?) / 2)), 2) +
      cos(radians(?)) * cos(radians("latitude")) * power(sin(radians(("longitude" - ?) / 2)), 2))))`;
    const { latitude: la, longitude: lo, raio_km } = q.perto;
    selectExtra.push(`round(${dist}, 3) as ${id(CAMPO_DISTANCIA)}`);
    paramsSelect.push(la, la, lo);
    // pré-filtro por caixa (barato) + distância exata
    const dLat = raio_km / 111.0;
    const dLon = raio_km / (111.320 * Math.max(Math.cos((la * Math.PI) / 180), 0.01));
    where.push(`"latitude" between ? and ? and "longitude" between ? and ? and ${dist} <= ?`);
    params.push(la - dLat, la + dLat, lo - dLon, lo + dLon, la, la, lo, raio_km);
  }

  if (q.contendo_ponto) {
    const geo = c.campos.find((f) => f.tipo === "geometria");
    if (!geo) {
      throw new ErroConsulta(`${c.id} não tem geometria; não use "contendo_ponto".`, "sem_geometria");
    }
    espacial = true;
    where.push(`st_contains(st_geomfromgeojson(${id(geo.nome)}), st_point(?, ?))`);
    params.push(q.contendo_ponto.longitude, q.contendo_ponto.latitude);
  }

  for (const [nome, filtro] of Object.entries(q.filtros ?? {})) {
    exigirCampo(nome, "filtros");
    const def = c.campos.find((f) => f.nome === nome)!;
    if (def.filtravel === false || def.tipo === "geometria") {
      throw new ErroConsulta(`Campo "${nome}" não aceita filtro.`, "campo_nao_filtravel");
    }
    const { op, valor } =
      Array.isArray(filtro)
        ? { op: "in" as const, valor: filtro }
        : typeof filtro === "object"
          ? filtro
          : { op: "eq" as const, valor: filtro };
    // valor do tipo errado vira erro de uso com dica (antes virava "erro interno" no banco)
    for (const v of Array.isArray(valor) ? valor : [valor]) {
      const ruim =
        (def.tipo === "texto" && typeof v === "boolean") ||
        ((def.tipo === "inteiro" || def.tipo === "decimal") && (typeof v === "boolean" || (typeof v === "string" && op !== "contem" && Number.isNaN(Number(v))))) ||
        (def.tipo === "booleano" && typeof v !== "boolean");
      if (ruim) {
        const dica = def.tipo === "texto"
          ? `é texto: use o valor como texto (ex.: "Sim"), não ${JSON.stringify(v)}`
          : def.tipo === "booleano" ? "é verdadeiro/falso: use true ou false" : "é numérico: use um número";
        throw new ErroConsulta(`O campo "${nome}" ${dica}. ${def.descricao}`, "valor_invalido", { campo: nome, tipo: def.tipo });
      }
    }

    if (op === "in") {
      const lista = Array.isArray(valor) ? valor : [valor];
      where.push(`${id(nome)} in (${lista.map(() => "?").join(", ")})`);
      params.push(...lista);
      continue;
    }
    if (Array.isArray(valor)) {
      throw new ErroConsulta(`Operador "${op}" não aceita lista (campo "${nome}").`, "filtro_invalido");
    }
    if (op === "contem") {
      // sem diferença de maiúscula e acento
      where.push(`strip_accents(lower(cast(${id(nome)} as varchar))) like '%' || strip_accents(lower(?)) || '%'`);
      params.push(String(valor));
      continue;
    }
    const sinal = { eq: "=", ne: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[op];
    where.push(`${id(nome)} ${sinal} ?`);
    params.push(valor);
  }

  if (q.inicio !== undefined || q.fim !== undefined) {
    if (!c.campoTempo) {
      throw new ErroConsulta(`${c.id} não tem dimensão de tempo; não use inicio/fim.`, "sem_tempo");
    }
    if (q.inicio !== undefined) {
      where.push(`cast(${id(c.campoTempo)} as varchar) >= ?`);
      params.push(q.inicio);
    }
    if (q.fim !== undefined) {
      where.push(`cast(${id(c.campoTempo)} as varchar) <= ?`);
      params.push(q.fim);
    }
  }

  const ordemPadrao = q.perto
    ? [{ campo: CAMPO_DISTANCIA, direcao: "asc" as const }]
    : c.ordenacaoPadrao.map((campo) => ({ campo, direcao: "asc" as const }));
  const ordem = (q.ordenar ?? ordemPadrao).map(
    (o) => {
      if (o.campo === CAMPO_DISTANCIA && q.perto) {
        return `${id(CAMPO_DISTANCIA)} ${o.direcao === "desc" ? "desc" : "asc"}`;
      }
      exigirCampo(o.campo, "ordenar");
      if (ehGeo(o.campo)) throw new ErroConsulta(`Não dá para ordenar por geometria ("${o.campo}").`, "campo_nao_filtravel");
      return `${id(o.campo)} ${o.direcao === "desc" ? "desc" : "asc"} nulls last`;
    },
  );

  const from = `from ${id(c.tabela)}${where.length ? ` where ${where.join(" and ")}` : ""}`;
  return {
    sql:
      `select ${[...campos.map(id), ...selectExtra].join(", ")} ${from}` +
      (ordem.length ? ` order by ${ordem.join(", ")}` : "") +
      ` limit ${q.limite} offset ${q.deslocamento}`,
    sqlTotal: `select count(*) as total ${from}`,
    params: [...paramsSelect, ...params],
    paramsTotal: params,
    espacial,
  };
}
