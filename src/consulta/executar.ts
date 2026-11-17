import { abrirProveniencia, TempoEsgotado, type Banco, type Linha, type Proveniencia } from "../banco/db.ts";
import { limparLinha } from "../seguranca/texto.ts";
import { acharConjunto, CONJUNTOS } from "../dominios/catalogo.ts";
import { Consulta } from "./schema.ts";
import { ErroConsulta, montarSql } from "./sql.ts";

export interface RespostaConsulta {
  conjunto: string;
  dados: Linha[];
  total: number;
  limite: number;
  deslocamento: number;
  proveniencia: Proveniencia & { atribuicao: string; licenca_url: string };
  avisos: string[];
}

export async function executarConsulta(banco: Banco, entrada: unknown): Promise<RespostaConsulta> {
  const parse = Consulta.safeParse(entrada);
  if (!parse.success) {
    throw new ErroConsulta("Consulta inválida.", "consulta_invalida", {
      problemas: parse.error.issues.map((i) => ({ caminho: i.path.join("."), mensagem: i.message })),
    });
  }
  const q = parse.data;
  const c = acharConjunto(q.conjunto);
  if (!c) {
    throw new ErroConsulta(`Conjunto "${q.conjunto}" não existe.`, "conjunto_invalido", {
      conjuntos_validos: [...CONJUNTOS.keys()],
    });
  }

  const [bruta] = await banco.consultar<Proveniencia & Linha>(
    "select * from _proveniencia where conjunto = ?",
    [c.id],
  );
  const prov = bruta && abrirProveniencia(bruta);
  if (!prov || !(await banco.tabelaExiste(c.tabela))) {
    throw new ErroConsulta(
      `O conjunto ${c.id} ainda não foi coletado neste servidor. Rode: npm run coletar -- ${c.dominio}`,
      "nao_coletado",
    );
  }

  const { sql, sqlTotal, params, paramsTotal, espacial } = montarSql(c, q);
  if (espacial) await banco.carregarEspacial();
  let dados: Linha[];
  let total: { total: number | string }[];
  try {
    dados = await banco.consultar(sql, params);
    total = await banco.consultar<{ total: number | string }>(sqlTotal, paramsTotal);
  } catch (e) {
    if (e instanceof TempoEsgotado) {
      throw new ErroConsulta(`${e.message} Refine os filtros, peça menos campos ou um período menor.`, "tempo_esgotado");
    }
    if (/Conversion Error|Could not convert|Invalid Input Error/i.test(String((e as Error)?.message ?? e))) {
      throw new ErroConsulta("Um valor de filtro não é compatível com o tipo do campo. Confira os tipos em descrever_conjunto.", "valor_invalido");
    }
    throw e;
  }
  // geometria fica guardada como texto GeoJSON; devolve como objeto
  const geos = c.campos.filter((f) => f.tipo === "geometria").map((f) => f.nome);
  const naoLimpar = new Set(geos);
  let invisiveis = 0;
  for (const l of dados) {
    invisiveis += limparLinha(l, naoLimpar);
    for (const g of geos) if (typeof l[g] === "string") l[g] = JSON.parse(l[g] as string);
  }

  const avisos = [...(c.avisos ?? [])];
  if (invisiveis > 0) {
    avisos.push(`${invisiveis} caractere(s) invisível(is) ou de controle removido(s) dos textos da fonte (o texto visível não mudou).`);
  }
  const n = Number(total[0]?.total ?? 0);
  if (n > q.deslocamento + dados.length) {
    avisos.push(
      `Resultado paginado: ${dados.length} de ${n} linhas. Use "deslocamento" para as próximas ou refine os filtros.`,
    );
  }

  return {
    conjunto: c.id,
    dados,
    total: n,
    limite: q.limite,
    deslocamento: q.deslocamento,
    proveniencia: { ...prov, atribuicao: c.fonte.atribuicao, licenca_url: c.fonte.licencaUrl },
    avisos,
  };
}
