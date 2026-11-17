import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registrarProveniencia, type Banco, type Linha } from "../banco/db.ts";
import { substituirTabela } from "../banco/carga.ts";
import { ANA_HIDROWEB } from "../dominios/fontes.ts";
import { baixarJson } from "./http.ts";
import type { Coletor } from "./tipos.ts";

/**
 * Séries históricas e telemétricas do Hidroweb (ANA).
 *
 * O dado é público, mas o serviço exige cadastro gratuito na ANA: usuário e senha
 * trocados por um token de 1 h. A credencial fica no .env de quem coleta, vai só
 * no cabeçalho para o próprio serviço e nunca entra no banco, em log ou na proveniência.
 *
 * O serviço só aceita uma estação por chamada (séries convencionais, até 366 dias)
 * ou até 10 (telemetria, até 30 dias). Por isso coletamos uma LISTA de estações
 * (config/hidroweb-estacoes.json ou BDU_HIDROWEB_ESTACOES), não a rede inteira.
 */

export const BASE = "https://www.ana.gov.br/hidrowebservice/EstacoesTelemetricas";
const PAGINA = "https://www.snirh.gov.br/hidroweb";
const ARQUIVO_ESTACOES = fileURLToPath(new URL("../../config/hidroweb-estacoes.json", import.meta.url));
const TELEMETRIA_DIAS = Number(process.env.BDU_HIDROWEB_TELEMETRIA_DIAS ?? 365);
const SIMULTANEAS = Number(process.env.BDU_HIDROWEB_SIMULTANEAS ?? 4);
const VALIDADE_TOKEN_MS = 50 * 60_000; // o token vale 1 h; renova antes

// ───────────────────────── transformações (puras, testadas) ─────────────────────────

/** Lê um campo sem depender de maiúsculas/sublinhado (a API escreve `nivelconsistencia` e `Nivel_Consistencia`). */
export function campo(item: Linha, nome: string): unknown {
  const alvo = nome.replaceAll("_", "").toLowerCase();
  for (const [k, v] of Object.entries(item)) if (k.replaceAll("_", "").toLowerCase() === alvo) return v;
  return undefined;
}

export function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

/** Nível de consistência da base HIDRO: 1 = bruto, 2 = consistido. Outro valor é erro (não adivinhamos). */
export function nivelConsistencia(v: unknown): "bruto" | "consistido" {
  const s = String(v ?? "").trim();
  if (s === "1") return "bruto";
  if (s === "2") return "consistido";
  throw new Error(`Hidroweb: nível de consistência desconhecido (${JSON.stringify(v)})`);
}

/** "2013-07-02 00:00:00.0" → "2013-07-02" */
const soData = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
/** "2026-11-15 23:00:00.0" → "2026-11-15 23:00:00" */
const dataHora = (v: unknown) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(v) ? v.slice(0, 19) : null;

export type Variavel = "cota" | "vazao" | "chuva";
const PREFIXO: Record<Variavel, string> = { cota: "Cota", vazao: "Vazao", chuva: "Chuva" };
const TIPO_MEDICAO: Record<Variavel, string> = { cota: "Tipo_Medicao_Cotas", vazao: "Metodo_Obtencao_Vazoes", chuva: "Tipo_Medicao_Chuvas" };

export interface Diario {
  codigo: string;
  data: string;
  valor: number;
  status: string | null;
  nivel_consistencia: "bruto" | "consistido";
  tipo_medicao: string | null;
  atualizado_em: string | null;
}

/**
 * A API devolve um registro por mês com colunas `Cota_01`…`Cota_31`. Desdobra em um
 * registro por dia, descartando dias que não existem no mês e dias sem valor.
 * Nas cotas, o bruto vem também com as leituras das 7 h e 17 h (`Mediadiaria` = 0);
 * guardamos só a média diária (`Mediadiaria` = 1), que é o que o consistido traz.
 */
export function desdobrarMensal(item: Linha, variavel: Variavel): Diario[] {
  const md = campo(item, "Mediadiaria");
  if (md !== undefined && md !== null && String(md) !== "1") return [];
  const ref = soData(campo(item, "Data_Hora_Dado"));
  if (!ref) throw new Error(`Hidroweb: registro sem Data_Hora_Dado (${JSON.stringify(campo(item, "codigoestacao"))})`);
  const [ano, mes] = [Number(ref.slice(0, 4)), Number(ref.slice(5, 7))];
  const diasNoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const base = {
    codigo: String(campo(item, "codigoestacao")),
    nivel_consistencia: nivelConsistencia(campo(item, "Nivel_Consistencia")),
    tipo_medicao: (campo(item, TIPO_MEDICAO[variavel]) as string | null | undefined) ?? null,
    atualizado_em: soData(campo(item, "Data_Ultima_Alteracao")),
  };
  const saida: Diario[] = [];
  for (let d = 1; d <= diasNoMes; d++) {
    const dd = String(d).padStart(2, "0");
    const valor = numero(campo(item, `${PREFIXO[variavel]}_${dd}`));
    if (valor === null) continue;
    const st = campo(item, `${PREFIXO[variavel]}_${dd}_Status`);
    saida.push({ ...base, data: `${ref.slice(0, 8)}${dd}`, valor, status: st == null ? null : String(st) });
  }
  return saida;
}

export type Telemetrico = {
  codigo: string;
  data_hora: string;
  chuva_mm: number | null;
  chuva_status: string | null;
  cota_cm: number | null;
  cota_status: string | null;
  vazao_m3s: number | null;
  vazao_status: string | null;
  atualizado_em: string | null;
};

export function lerTelemetrico(item: Linha): Telemetrico | null {
  const dh = dataHora(campo(item, "Data_Hora_Medicao"));
  if (!dh) return null;
  const st = (n: string) => {
    const v = campo(item, n);
    return v == null ? null : String(v);
  };
  return {
    codigo: String(campo(item, "codigoestacao")),
    data_hora: dh,
    chuva_mm: numero(campo(item, "Chuva_Adotada")),
    chuva_status: st("Chuva_Adotada_Status"),
    cota_cm: numero(campo(item, "Cota_Adotada")),
    cota_status: st("Cota_Adotada_Status"),
    vazao_m3s: numero(campo(item, "Vazao_Adotada")),
    vazao_status: st("Vazao_Adotada_Status"),
    atualizado_em: dataHora(campo(item, "Data_Atualizacao")),
  };
}

/** Anos a pedir para cada variável, a partir dos períodos do inventário da estação. */
export function anosPorVariavel(inv: Linha, anoAtual = new Date().getUTCFullYear()): Record<Variavel, number[]> {
  const ano = (n: string) => {
    const d = soData(campo(inv, n));
    return d ? Number(d.slice(0, 4)) : null;
  };
  const intervalo = (pares: [string, string][]) => {
    let ini: number | null = null;
    let fim: number | null = null;
    for (const [a, b] of pares) {
      const i = ano(a);
      if (i === null) continue;
      ini = ini === null ? i : Math.min(ini, i);
      fim = Math.max(fim ?? i, ano(b) ?? anoAtual); // sem fim = ainda em operação
    }
    if (ini === null || fim === null) return [];
    return Array.from({ length: Math.min(fim, anoAtual) - ini + 1 }, (_, k) => ini! + k);
  };
  const nivel: [string, string][] = [
    ["Data_Periodo_Escala_Inicio", "Data_Periodo_Escala_Fim"],
    ["Data_Periodo_Registrador_Nivel_Inicio", "Data_Periodo_Registrador_Nivel_Fim"],
  ];
  return {
    cota: intervalo(nivel),
    // vazão diária sai da cota pela curva-chave: pede nos anos de cota, se a estação mede descarga
    vazao: ano("Data_Periodo_Desc_Liquida_Inicio") === null ? [] : intervalo(nivel),
    chuva: intervalo([
      ["Data_Periodo_Pluviometro_Inicio", "Data_Periodo_Pluviometro_Fim"],
      ["Data_Periodo_Registrador_Chuva_Inicio", "Data_Periodo_Registrador_Chuva_Fim"],
    ]),
  };
}

/** Lista de estações: BDU_HIDROWEB_ESTACOES (vírgulas) ou config/hidroweb-estacoes.json. */
export function lerEstacoes(env = process.env, arquivo = ARQUIVO_ESTACOES): string[] {
  const bruto = env.BDU_HIDROWEB_ESTACOES
    ? env.BDU_HIDROWEB_ESTACOES.split(",")
    : (JSON.parse(readFileSync(arquivo, "utf8")) as { estacoes: { codigo: string }[] }).estacoes.map((e) => e.codigo);
  const codigos = [...new Set(bruto.map((c) => String(c).trim()).filter(Boolean))];
  const ruins = codigos.filter((c) => !/^\d{5,8}$/.test(c));
  if (ruins.length) throw new Error(`Hidroweb: código(s) de estação inválido(s): ${ruins.join(", ")}`);
  if (codigos.length === 0) throw new Error("Hidroweb: lista de estações vazia");
  return codigos;
}

// ───────────────────────── cliente do serviço ─────────────────────────

interface Devolucao<T> { status?: string; code?: number; message?: string; items?: T }

class ClienteHidroweb {
  private token: string | null = null;
  private obtidoEm = 0;
  requisicoes = 0;

  constructor(private readonly identificador: string, private readonly senha: string) {}

  private async entrar(): Promise<string> {
    const r = await baixarJson<Devolucao<{ tokenautenticacao?: string }>>(`${BASE}/OAUth/v1`, {
      cabecalhos: { Identificador: this.identificador, Senha: this.senha },
      tentativas: 5,
    }).catch((e: unknown) => {
      const m = e instanceof Error ? e.message : String(e);
      throw new Error(m.startsWith("HTTP 401") ? "Hidroweb: login recusado — confira ANA_HIDRO_IDENTIFICADOR e ANA_HIDRO_SENHA no .env" : `Hidroweb: falha no login (${m})`);
    });
    const t = r.items?.tokenautenticacao;
    if (!t) throw new Error(`Hidroweb: login sem token (${r.message ?? "resposta inesperada"})`);
    this.token = t;
    this.obtidoEm = Date.now();
    return t;
  }

  /** GET com token; renova o token se expirou ou se o serviço responder 401. */
  async get<T>(caminho: string, params: Record<string, string>): Promise<T[]> {
    const u = new URL(`${BASE}/${caminho}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const token = this.token && Date.now() - this.obtidoEm < VALIDADE_TOKEN_MS ? this.token : await this.entrar();
      try {
        this.requisicoes++;
        const r = await baixarJson<Devolucao<T[] | null>>(u.toString(), {
          cabecalhos: { Authorization: `Bearer ${token}` },
          tentativas: 5,
          tempoLimiteMs: 120_000,
        });
        if (r.code !== undefined && r.code !== 200) throw new Error(`Hidroweb ${caminho}: ${r.code} ${r.message ?? ""}`);
        return Array.isArray(r.items) ? r.items : [];
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("HTTP 401") && tentativa === 0) {
          this.token = null;
          continue;
        }
        throw e;
      }
    }
    throw new Error(`Hidroweb ${caminho}: não autorizado mesmo após renovar o token`);
  }
}

/** Roda tarefas com no máximo `n` ao mesmo tempo, na ordem. */
async function emLotes<T, R>(itens: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const saida: R[] = new Array(itens.length);
  let proximo = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, itens.length) }, async () => {
      while (proximo < itens.length) {
        const i = proximo++;
        saida[i] = await fn(itens[i]!);
      }
    }),
  );
  return saida;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

// ───────────────────────── coletor ─────────────────────────

const SERIE: Record<Variavel, { caminho: string; conjunto: string; tabela: string; coluna: string; unidade: string }> = {
  cota: { caminho: "HidroSerieCotas/v1", conjunto: "agua.cotas", tabela: "agua_cotas", coluna: "cota_cm", unidade: "cm" },
  vazao: { caminho: "HidroSerieVazao/v1", conjunto: "agua.vazoes", tabela: "agua_vazoes", coluna: "vazao_m3s", unidade: "m³/s" },
  chuva: { caminho: "HidroSerieChuva/v1", conjunto: "agua.chuvas", tabela: "agua_chuvas", coluna: "chuva_mm", unidade: "mm" },
};

export const coletorHidroweb: Coletor = {
  dominio: "agua",
  id: "hidroweb",
  conjuntos: ["agua.cotas", "agua.vazoes", "agua.chuvas", "agua.telemetria"],

  indisponivel() {
    if (!process.env.ANA_HIDRO_IDENTIFICADOR || !process.env.ANA_HIDRO_SENHA) {
      return "sem credencial do Hidroweb (ANA_HIDRO_IDENTIFICADOR e ANA_HIDRO_SENHA no .env; cadastro gratuito na ANA)";
    }
    return null;
  },

  async coletar(banco, log) {
    const cliente = new ClienteHidroweb(process.env.ANA_HIDRO_IDENTIFICADOR!, process.env.ANA_HIDRO_SENHA!);
    const estacoes = lerEstacoes();
    log(`Hidroweb: ${estacoes.length} estações (${estacoes.join(", ")})`);

    // 1. inventário de cada estação: confirma que existe e diz quais anos pedir
    const inventarios = await emLotes(estacoes, SIMULTANEAS, async (codigo) => {
      const [inv] = await cliente.get<Linha>("HidroInventarioEstacoes/v1", { "Código da Estação": codigo });
      if (!inv) throw new Error(`Hidroweb: estação ${codigo} não encontrada no inventário`);
      return { codigo, nome: String(campo(inv, "Estacao_Nome") ?? ""), anos: anosPorVariavel(inv) };
    });

    // 2. séries convencionais, um ano por chamada
    const pedidos = inventarios.flatMap(({ codigo, anos }) =>
      (Object.keys(SERIE) as Variavel[]).flatMap((v) => anos[v].map((ano) => ({ codigo, v, ano }))),
    );
    log(`Hidroweb: ${pedidos.length} pedidos de séries convencionais…`);
    const diarios: Record<Variavel, Diario[]> = { cota: [], vazao: [], chuva: [] };
    let feitos = 0;
    await emLotes(pedidos, SIMULTANEAS, async ({ codigo, v, ano }) => {
      const itens = await cliente.get<Linha>(SERIE[v].caminho, {
        "Código da Estação": codigo,
        "Tipo Filtro Data": "DATA_LEITURA",
        "Data Inicial (yyyy-MM-dd)": `${ano}-01-01`,
        "Data Final (yyyy-MM-dd)": `${ano}-12-31`,
      });
      for (const it of itens) {
        // a API filtra pela data da leitura; garante que o registro é da estação e do ano pedidos
        if (String(campo(it, "codigoestacao")) !== codigo) throw new Error(`Hidroweb: pedi ${codigo} e veio ${String(campo(it, "codigoestacao"))}`);
        diarios[v].push(...desdobrarMensal(it, v).filter((d) => d.data.startsWith(String(ano))));
      }
      if (++feitos % 100 === 0) log(`Hidroweb: ${feitos}/${pedidos.length}`);
    });

    // 3. telemetria recente, até 10 estações e 30 dias por chamada
    const hoje = new Date();
    const janelas: string[] = [];
    for (let d = 0; d < TELEMETRIA_DIAS; d += 30) janelas.push(iso(new Date(hoje.getTime() - d * 86_400_000)));
    const grupos: string[][] = [];
    for (let i = 0; i < estacoes.length; i += 10) grupos.push(estacoes.slice(i, i + 10));
    const telemetria = new Map<string, Telemetrico>();
    // a ANA devolve a telemetria de alguns pluviômetros sob o código da fluviométrica do
    // mesmo posto automático (ex.: pedir 549013 traz 29050000): guarda com o código que
    // ela devolveu e registra o apelido na proveniência
    const codigosDevolvidos = new Set<string>();
    const corte = `${iso(new Date(hoje.getTime() - TELEMETRIA_DIAS * 86_400_000))} 00:00:00`;
    let foraDaJanela = 0;
    await emLotes(grupos.flatMap((g) => janelas.map((dia) => ({ g, dia }))), SIMULTANEAS, async ({ g, dia }) => {
      const itens = await cliente.get<Linha>("HidroinfoanaSerieTelemetricaAdotada/v2", {
        Codigos_Estacoes: g.join(","),
        "Tipo Filtro Data": "DATA_LEITURA",
        "Data de Busca (yyyy-MM-dd)": dia,
        "Range Intervalo de busca": "DIAS_30",
      });
      for (const it of itens) {
        const t = lerTelemetrico(it);
        if (!t) continue;
        if (t.data_hora < corte) { foraDaJanela++; continue; }
        codigosDevolvidos.add(t.codigo);
        telemetria.set(`${t.codigo}|${t.data_hora}`, t); // janelas vizinhas se sobrepõem na borda
      }
    });

    // 4. grava
    const colunasDiario = (coluna: string) => ({
      codigo: "VARCHAR", data: "DATE", [coluna]: "DOUBLE", status: "VARCHAR",
      nivel_consistencia: "VARCHAR", tipo_medicao: "VARCHAR", atualizado_em: "DATE",
    });
    const nomes = Object.fromEntries(inventarios.map((i) => [i.codigo, i.nome]));
    for (const v of Object.keys(SERIE) as Variavel[]) {
      const s = SERIE[v];
      const linhas = diarios[v].map(({ valor, ...d }) => ({ ...d, [s.coluna]: valor }));
      await substituirTabela(banco, s.tabela, colunasDiario(s.coluna), linhas);
      const [r] = await banco.consultar<{ n: number; ini: string | null; fim: string | null; est: number; cons: number }>(
        `select count(*)::bigint n, min(data)::varchar ini, max(data)::varchar fim, count(distinct codigo)::bigint est,
                count(*) filter (where nivel_consistencia = 'consistido')::bigint cons from ${s.tabela}`,
      );
      const comDado = [...new Set(diarios[v].map((d) => d.codigo))];
      await registrarProveniencia(banco, {
        conjunto: s.conjunto,
        fonte: ANA_HIDROWEB.nome,
        url_origem: `${PAGINA} ; ${BASE}/${s.caminho}`,
        licenca: ANA_HIDROWEB.licenca,
        data_referencia: r?.ini ? `${r.ini} a ${r.fim}` : "sem dados nas estações coletadas",
        linhas: Number(r?.n ?? 0),
        observacao:
          `Estações pedidas: ${estacoes.map((c) => `${c} ${nomes[c]}`).join("; ")}. ` +
          `Com dado: ${comDado.length ? comDado.join(", ") : "nenhuma"}. ` +
          `${r?.cons ?? 0} de ${r?.n ?? 0} valores diários consistidos, o resto bruto. ` +
          "O serviço exige cadastro gratuito na ANA; a credencial não é guardada.",
      });
      log(`Hidroweb: ${s.conjunto} gravado (${r?.n} valores diários, ${r?.est} estações, ${r?.ini ?? "—"} a ${r?.fim ?? "—"}).`);
    }

    const semTelemetria = estacoes.filter((c) => !codigosDevolvidos.has(c));
    const apelidos = [...codigosDevolvidos].filter((c) => !estacoes.includes(c));
    log(`Hidroweb: telemetria descartou ${foraDaJanela} leitura(s) anteriores a ${corte}.`);
    await substituirTabela(banco, "agua_telemetria", {
      // horários como texto: a ANA não informa o fuso, e TIMESTAMP sairia como ISO "…Z" (afirmaria UTC)
      codigo: "VARCHAR", data_hora: "VARCHAR", chuva_mm: "DOUBLE", chuva_status: "VARCHAR",
      cota_cm: "DOUBLE", cota_status: "VARCHAR", vazao_m3s: "DOUBLE", vazao_status: "VARCHAR", atualizado_em: "VARCHAR",
    }, [...telemetria.values()]);
    const [t] = await banco.consultar<{ n: number; ini: string | null; fim: string | null; est: number }>(
      "select count(*)::bigint n, min(data_hora) ini, max(data_hora) fim, count(distinct codigo)::bigint est from agua_telemetria",
    );
    await registrarProveniencia(banco, {
      conjunto: "agua.telemetria",
      fonte: ANA_HIDROWEB.nome,
      url_origem: `${PAGINA} ; ${BASE}/HidroinfoanaSerieTelemetricaAdotada/v2`,
      licenca: ANA_HIDROWEB.licenca,
      data_referencia: t?.ini ? `${t.ini} a ${t.fim}` : "sem dados nas estações coletadas",
      linhas: Number(t?.n ?? 0),
      observacao:
        `Últimos ${TELEMETRIA_DIAS} dias das estações pedidas (${estacoes.join(", ")}); ${t?.est ?? 0} com dado telemétrico. ` +
        "Valores adotados pela ANA, sem consistência. " +
        (semTelemetria.length ? `Sem telemetria devolvida sob o próprio código: ${semTelemetria.join(", ")}. ` : "") +
        (apelidos.length ? `Devolvidos sob código não pedido (mesmo posto automático de outra estação): ${apelidos.join(", ")}. ` : "") +
        "O serviço exige cadastro gratuito na ANA; a credencial não é guardada.",
    });
    log(`Hidroweb: agua.telemetria gravado (${t?.n} registros, ${t?.est} estações, ${t?.ini ?? "—"} a ${t?.fim ?? "—"}; ${cliente.requisicoes} requisições).`);
  },
};
