import type { Banco } from "../banco/db.ts";
import type { Conjunto } from "../dominios/tipos.ts";

/**
 * Portões de qualidade: rodam DEPOIS da coleta e ANTES de publicar. Se algum
 * falha, a coleta inteira daquele domínio é desfeita e o servidor continua com
 * a versão anterior — melhor um dado de ontem conferido do que um de hoje errado.
 */
export interface Verificacao {
  nome: string;
  ok: boolean;
  detalhe: string;
  /** false = só alerta (fica registrado, não impede publicar). */
  bloqueante?: boolean;
}

export const falhou = (v: Verificacao) => !v.ok && v.bloqueante !== false;

export interface OpcoesVerificacao {
  /** Linhas da coleta anterior (da proveniência), se houver. */
  linhasAnteriores?: number;
  /** Queda máxima aceita de uma coleta para outra (0,2 = 20%). */
  quedaMaxima?: number;
}

const QUEDA_MAXIMA = Number(process.env.BDU_QUEDA_MAXIMA ?? 0.2);
const ident = (n: string) => `"${n.replaceAll('"', '""')}"`;

export async function verificarConjunto(
  banco: Banco,
  c: Conjunto,
  { linhasAnteriores, quedaMaxima = QUEDA_MAXIMA }: OpcoesVerificacao = {},
): Promise<Verificacao[]> {
  const v: Verificacao[] = [];

  if (!(await banco.tabelaExiste(c.tabela))) {
    return [{ nome: "tabela_existe", ok: false, detalhe: `tabela ${c.tabela} não foi criada` }];
  }

  // 1. todo campo do catálogo existe na tabela (o que documentamos é o que servimos)
  const colunas = new Set(
    (await banco.consultar<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = ?",
      [c.tabela],
    )).map((r) => r.column_name),
  );
  const faltando = c.campos.map((f) => f.nome).filter((n) => !colunas.has(n));
  v.push({
    nome: "campos_do_catalogo",
    ok: faltando.length === 0,
    detalhe: faltando.length ? `faltam na tabela: ${faltando.join(", ")}` : `${c.campos.length} campos presentes`,
  });
  if (faltando.length) return v;

  // 2. não está vazia
  const [{ n } = { n: 0 }] = await banco.consultar<{ n: number }>(`select count(*)::bigint as n from ${ident(c.tabela)}`);
  v.push({
    nome: "nao_vazia",
    ok: n > 0,
    detalhe: `${n} linhas${n === 0 && c.podeFicarVazio ? " (permitido: depende das estações escolhidas)" : ""}`,
    ...(c.podeFicarVazio ? { bloqueante: false } : {}),
  });

  // 3. a chave declarada é única e não nula (cada valor tem um endereço só)
  const chave = c.chave.map(ident).join(", ");
  const [rep] = await banco.consultar<{ repetidas: number; nulas: number }>(
    `select
       (select count(*)::bigint from (select 1 from ${ident(c.tabela)} group by ${chave} having count(*) > 1)) as repetidas,
       (select count(*)::bigint from ${ident(c.tabela)} where ${c.chave.map((k) => `${ident(k)} is null`).join(" or ")}) as nulas`,
  );
  v.push({
    nome: "chave_unica",
    ok: (rep?.repetidas ?? 0) === 0 && (rep?.nulas ?? 0) === 0,
    detalhe: `chave (${c.chave.join(", ")}): ${rep?.repetidas ?? 0} repetida(s), ${rep?.nulas ?? 0} com nulo`,
  });

  // 4. não encolheu demais em relação à coleta anterior (fonte quebrada ou parcial)
  if (linhasAnteriores && linhasAnteriores > 0) {
    const queda = (linhasAnteriores - n) / linhasAnteriores;
    v.push({
      nome: "sem_queda_brusca",
      ok: queda <= quedaMaxima,
      detalhe: `${linhasAnteriores} → ${n} linhas (${(queda * -100).toFixed(1)}%; limite −${(quedaMaxima * 100).toFixed(0)}%)`,
    });
  }

  // 5. o campo de tempo tem valores (a data de referência precisa existir)
  if (c.campoTempo) {
    const [t] = await banco.consultar<{ nulos: number }>(
      `select count(*)::bigint as nulos from ${ident(c.tabela)} where ${ident(c.campoTempo)} is null`,
    );
    const nulos = t?.nulos ?? 0;
    v.push({
      nome: "tempo_preenchido",
      ok: nulos / Math.max(n, 1) <= 0.01,
      detalhe: `${nulos} linha(s) sem ${c.campoTempo}`,
      bloqueante: false,
    });
  }

  return v;
}
