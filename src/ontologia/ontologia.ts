/**
 * Ontologia do setor de água e energia no Brasil — conceitos, como se ligam
 * e onde cada um está nos dados deste servidor. Exportada em JSON-LD e Turtle.
 *
 * Vocabulários: SKOS (conceitos, rótulos, sinônimos) e um namespace próprio
 * (`bdu:`) para as ligações com conjuntos e campos.
 */
import type { Banco } from "../banco/db.ts";
import { INDICADORES_CONTINUIDADE } from "../dominios/energia.ts";

export const NS = "https://balance.ia.br/brasil-dados-utilities/ontologia#";

export interface Conceito {
  id: string;
  tipo: "Entidade" | "Indicador" | "Grandeza";
  rotulo: string;
  rotuloEn: string;
  sinonimos?: string[];
  definicao: string;
  /** Conceito mais amplo (skos:broader). */
  amplo?: string;
  /** Onde está: conjunto(s) e campo. */
  onde: { conjunto: string; campo?: string; filtro?: Record<string, unknown> }[];
  /** Chave que identifica a entidade nos dados (para juntar conjuntos). */
  chave?: string;
  /** Ligações com outras entidades: propriedade → conceito. */
  ligacoes?: Record<string, string>;
  fonte?: string;
}

const ENTIDADES: Conceito[] = [
  {
    id: "Municipio", tipo: "Entidade", rotulo: "Município", rotuloEn: "Municipality",
    sinonimos: ["cidade", "city"], chave: "codigo_ibge",
    definicao: "Unidade político-administrativa; o código IBGE de 7 dígitos é a chave comum a todos os domínios.",
    onde: [{ conjunto: "territorio.municipios" }, { conjunto: "territorio.malha_municipios" }],
    ligacoes: { pertenceA: "UnidadeFederativa" }, fonte: "IBGE",
  },
  {
    id: "UnidadeFederativa", tipo: "Entidade", rotulo: "Unidade da Federação", rotuloEn: "State",
    sinonimos: ["UF", "estado"], chave: "uf",
    definicao: "Estado ou Distrito Federal.", onde: [{ conjunto: "territorio.ufs" }], fonte: "IBGE",
  },
  {
    id: "Distribuidora", tipo: "Entidade", rotulo: "Distribuidora de energia", rotuloEn: "Electricity distribution utility",
    sinonimos: ["concessionária de distribuição", "permissionária", "DISCO", "utility"], chave: "cnpj",
    definicao: "Concessionária ou permissionária do serviço público de distribuição de energia elétrica regulada pela ANEEL.",
    onde: [{ conjunto: "energia.continuidade", campo: "distribuidora" }, { conjunto: "energia.balanco", campo: "distribuidora" }],
    fonte: "ANEEL",
  },
  {
    id: "ConjuntoEletrico", tipo: "Entidade", rotulo: "Conjunto elétrico de unidades consumidoras", rotuloEn: "Consumer unit set",
    sinonimos: ["conjunto de unidades consumidoras", "conjunto ANEEL"], chave: "conjunto_id",
    definicao: "Agrupamento de unidades consumidoras de uma distribuidora usado pela ANEEL para apurar e limitar DEC e FEC.",
    onde: [{ conjunto: "energia.continuidade" }, { conjunto: "energia.continuidade_limites" }, { conjunto: "energia.conjuntos_municipios" }],
    ligacoes: { pertenceA: "Distribuidora", atende: "Municipio" }, fonte: "ANEEL",
  },
  {
    id: "Subsistema", tipo: "Entidade", rotulo: "Subsistema do SIN", rotuloEn: "Interconnected grid subsystem",
    sinonimos: ["submercado", "N", "NE", "S", "SE/CO"], chave: "subsistema_id",
    definicao: "Divisão do Sistema Interligado Nacional usada na operação pelo ONS: Norte, Nordeste, Sul e Sudeste/Centro-Oeste.",
    onde: [{ conjunto: "energia.carga" }, { conjunto: "energia.reservatorios" }], fonte: "ONS",
  },
  {
    id: "PrestadorSaneamento", tipo: "Entidade", rotulo: "Prestador de serviço de saneamento", rotuloEn: "Water and sanitation utility",
    sinonimos: ["companhia de saneamento", "concessionária de água", "SAAE", "autarquia de água"],
    definicao: "Entidade que presta abastecimento de água e/ou esgotamento sanitário no município (companhia estadual, autarquia, empresa privada, prefeitura).",
    onde: [{ conjunto: "saneamento.indicadores", campo: "prestador" }],
    ligacoes: { atende: "Municipio" }, fonte: "SINISA",
  },
  {
    id: "EstacaoHidrometeorologica", tipo: "Entidade", rotulo: "Estação hidrometeorológica", rotuloEn: "Hydrometeorological station",
    sinonimos: ["régua", "estação fluviométrica", "pluviômetro", "posto", "gauge", "PCD"], chave: "codigo",
    definicao: "Ponto de monitoramento de nível/vazão de rios (fluviométrica) ou de chuva (pluviométrica) da Rede Hidrometeorológica Nacional.",
    onde: [{ conjunto: "agua.estacoes" }], ligacoes: { localizadaEm: "Municipio" }, fonte: "ANA",
  },
  {
    id: "SetorDeRisco", tipo: "Entidade", rotulo: "Setor de risco geológico", rotuloEn: "Geological hazard risk sector",
    sinonimos: ["área de risco", "risk area"], chave: "id_sgb",
    definicao: "Área delimitada pelo SGB com risco alto ou muito alto de deslizamento, inundação, erosão e processos correlatos, com população exposta.",
    onde: [{ conjunto: "territorio.risco_setores" }], ligacoes: { localizadoEm: "Municipio" }, fonte: "SGB",
  },
];

const GRANDEZAS: Conceito[] = [
  {
    id: "PerdasEnergiaDistribuicao", tipo: "Grandeza", rotulo: "Perdas na distribuição de energia", rotuloEn: "Distribution energy losses",
    sinonimos: ["perdas totais", "perdas técnicas e não técnicas", "energy losses"],
    definicao: "Energia injetada na rede da distribuidora que não chega faturada ao consumidor, como declarada no balanço SAMP (totais; a separação técnica/não técnica não é publicada neste conjunto).",
    onde: [{ conjunto: "energia.balanco", campo: "energia_kwh", filtro: { modalidade: "Perdas na Distribuição (valor medido)" } }],
    fonte: "ANEEL",
  },
  {
    id: "EnergiaArmazenada", tipo: "Grandeza", rotulo: "Energia armazenada (EAR)", rotuloEn: "Stored energy (reservoir level)",
    sinonimos: ["nível dos reservatórios", "EAR", "reservoir storage"],
    definicao: "Energia associada ao volume de água disponível nos reservatórios do subsistema, em MWmês e em % da máxima.",
    onde: [{ conjunto: "energia.reservatorios", campo: "ear_percentual" }], fonte: "ONS",
  },
  {
    id: "CargaEnergia", tipo: "Grandeza", rotulo: "Carga de energia", rotuloEn: "Electricity load",
    sinonimos: ["demanda", "consumo do SIN", "load"],
    definicao: "Carga de energia do subsistema, média diária em MWmed.",
    onde: [{ conjunto: "energia.carga", campo: "carga_mwmed" }], fonte: "ONS",
  },
  {
    id: "PessoasEmRisco", tipo: "Grandeza", rotulo: "Pessoas em área de risco", rotuloEn: "People exposed to hazard",
    definicao: "Estimativa de pessoas residentes no setor de risco mapeado.",
    onde: [{ conjunto: "territorio.risco_setores", campo: "pessoas" }], fonte: "SGB",
  },
];

function indicadoresContinuidade(): Conceito[] {
  return INDICADORES_CONTINUIDADE.map((i) => ({
    id: `Indicador_${i.codigo}`,
    tipo: "Indicador" as const,
    rotulo: i.codigo,
    rotuloEn:
      i.codigo === "DEC" ? "SAIDI-like: equivalent interruption duration per consumer"
      : i.codigo === "FEC" ? "SAIFI-like: equivalent interruption frequency per consumer"
      : `${i.codigo} (component of ${i.codigo.slice(0, 3)})`,
    sinonimos: i.codigo === "DEC" ? ["duração de interrupção", "SAIDI"] : i.codigo === "FEC" ? ["frequência de interrupção", "SAIFI"] : [],
    definicao: i.descricao,
    amplo: i.codigo.length > 3 ? `Indicador_${i.codigo.slice(0, 3)}` : undefined,
    onde: [{ conjunto: "energia.continuidade", campo: i.codigo.toLowerCase() }],
    fonte: "ANEEL",
  }));
}

/** Indicadores do SINISA vêm do dicionário coletado (99 códigos). */
async function indicadoresSaneamento(banco: Banco): Promise<Conceito[]> {
  if (!(await banco.tabelaExiste("saneamento_dicionario"))) return [];
  const linhas = await banco.consultar<{ modulo: string; indicador: string; nome: string; grupo: string; unidade: string }>(
    "select modulo, indicador, nome, grupo, unidade from saneamento_dicionario order by modulo, indicador",
  );
  const sinonimosConhecidos: Record<string, string[]> = {
    IAG2013: ["perdas de água", "perdas na distribuição", "água não faturada", "NRW", "water losses"],
    IAG0001: ["cobertura de água", "atendimento de água", "water coverage"],
    IES0001: ["cobertura de esgoto", "coleta de esgoto", "sewer coverage"],
    IES0007: ["tratamento de esgoto", "sewage treatment"],
    IAG2006: ["consumo per capita", "per capita consumption"],
  };
  return linhas.map((l) => ({
    id: `Indicador_${l.indicador}`,
    tipo: "Indicador" as const,
    rotulo: `${l.indicador} — ${l.nome}`,
    rotuloEn: sinonimosConhecidos[l.indicador]?.at(-1) ?? l.nome,
    sinonimos: sinonimosConhecidos[l.indicador],
    definicao: `${l.nome} (${l.unidade}; grupo ${l.grupo}; módulo ${l.modulo}). Definição completa no glossário oficial do SINISA.`,
    onde: [{ conjunto: "saneamento.indicadores", campo: "valor", filtro: { indicador: l.indicador } }],
    fonte: "SINISA",
  }));
}

export async function conceitos(banco: Banco): Promise<Conceito[]> {
  return [...ENTIDADES, ...GRANDEZAS, ...indicadoresContinuidade(), ...(await indicadoresSaneamento(banco))];
}

export async function ontologiaJsonLd(banco: Banco) {
  const lista = await conceitos(banco);
  return {
    "@context": {
      skos: "http://www.w3.org/2004/02/skos/core#",
      dct: "http://purl.org/dc/terms/",
      bdu: NS,
      prefLabel: { "@id": "skos:prefLabel", "@container": "@language" },
      altLabel: { "@id": "skos:altLabel", "@container": "@set" },
      definition: "skos:definition",
      broader: { "@id": "skos:broader", "@type": "@id" },
      inScheme: { "@id": "skos:inScheme", "@type": "@id" },
      source: "dct:source",
    },
    "@id": `${NS}esquema`,
    "@type": "skos:ConceptScheme",
    "dct:title": "Ontologia Brasil Dados Utilities — água, energia e território",
    "dct:creator": "Balance.ia",
    "@graph": lista.map((c) => ({
      "@id": `bdu:${c.id}`,
      "@type": ["skos:Concept", `bdu:${c.tipo}`],
      inScheme: `${NS}esquema`,
      prefLabel: { pt: c.rotulo, en: c.rotuloEn },
      ...(c.sinonimos?.length ? { altLabel: c.sinonimos } : {}),
      definition: c.definicao,
      ...(c.amplo ? { broader: `bdu:${c.amplo}` } : {}),
      ...(c.fonte ? { source: c.fonte } : {}),
      ...(c.chave ? { "bdu:chave": c.chave } : {}),
      "bdu:encontradoEm": c.onde.map((o) => ({
        "bdu:conjunto": o.conjunto,
        ...(o.campo ? { "bdu:campo": o.campo } : {}),
        ...(o.filtro ? { "bdu:filtro": JSON.stringify(o.filtro) } : {}),
      })),
      ...Object.fromEntries(Object.entries(c.ligacoes ?? {}).map(([p, alvo]) => [`bdu:${p}`, { "@id": `bdu:${alvo}` }])),
    })),
  };
}

const ttlStr = (s: string) => `"${s.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", " ")}"`;

export async function ontologiaTurtle(banco: Banco): Promise<string> {
  const lista = await conceitos(banco);
  const out = [
    "@prefix skos: <http://www.w3.org/2004/02/skos/core#> .",
    "@prefix dct: <http://purl.org/dc/terms/> .",
    `@prefix bdu: <${NS}> .`,
    "",
    `bdu:esquema a skos:ConceptScheme ; dct:title ${ttlStr("Ontologia Brasil Dados Utilities — água, energia e território")} ; dct:creator ${ttlStr("Balance.ia")} .`,
    "",
  ];
  for (const c of lista) {
    const t = [
      `bdu:${c.id} a skos:Concept, bdu:${c.tipo}`,
      `  skos:inScheme bdu:esquema`,
      `  skos:prefLabel ${ttlStr(c.rotulo)}@pt, ${ttlStr(c.rotuloEn)}@en`,
      ...(c.sinonimos ?? []).map((s) => `  skos:altLabel ${ttlStr(s)}`),
      `  skos:definition ${ttlStr(c.definicao)}@pt`,
      ...(c.amplo ? [`  skos:broader bdu:${c.amplo}`] : []),
      ...(c.fonte ? [`  dct:source ${ttlStr(c.fonte)}`] : []),
      ...(c.chave ? [`  bdu:chave ${ttlStr(c.chave)}`] : []),
      ...c.onde.map((o) => `  bdu:encontradoEm ${ttlStr(o.conjunto + (o.campo ? `#${o.campo}` : "") + (o.filtro ? ` ${JSON.stringify(o.filtro)}` : ""))}`),
      ...Object.entries(c.ligacoes ?? {}).map(([p, alvo]) => `  bdu:${p} bdu:${alvo}`),
    ];
    out.push(t.join(" ;\n") + " .", "");
  }
  return out.join("\n");
}

const semAcento = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Acha conceitos por termo (rótulo, sinônimo, código) — diz onde o dado está. */
export async function buscarConceitos(banco: Banco, termo: string) {
  const t = semAcento(termo.trim());
  if (!t) return [];
  const lista = await conceitos(banco);
  const pontuar = (c: Conceito) => {
    const rotulos = [c.rotulo, c.rotuloEn, c.id, ...(c.sinonimos ?? [])].map(semAcento);
    if (rotulos.some((r) => r === t)) return 3;
    if (rotulos.some((r) => r.includes(t))) return 2;
    return semAcento(c.definicao).includes(t) ? 1 : 0;
  };
  return lista
    .map((c) => ({ c, p: pontuar(c) }))
    .filter((x) => x.p > 0)
    .sort((a, b) => b.p - a.p)
    .slice(0, 15)
    .map(({ c }) => ({
      id: c.id, tipo: c.tipo, rotulo: c.rotulo, rotulo_en: c.rotuloEn, sinonimos: c.sinonimos ?? [],
      definicao: c.definicao, encontrado_em: c.onde, chave: c.chave ?? null, fonte: c.fonte ?? null,
    }));
}
