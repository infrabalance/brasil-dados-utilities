import { ANEEL, ONS } from "./fontes.ts";
import type { Campo, Dominio } from "./tipos.ts";

/**
 * Indicadores de continuidade publicados pela ANEEL (códigos do dicionário
 * "dominio-indicadores"). A coluna no banco é o código em minúsculas.
 */
export const INDICADORES_CONTINUIDADE: { codigo: string; descricao: string }[] = [
  { codigo: "DEC", descricao: "Duração Equivalente de Interrupção por Unidade Consumidora (interrupções ≥ 3 min)" },
  { codigo: "FEC", descricao: "Frequência Equivalente de Interrupção por Unidade Consumidora (interrupções ≥ 3 min)" },
  ...(["DEC", "FEC"] as const).flatMap((b) => [
    { codigo: `${b}IP`, descricao: `${b} — origem interna ao sistema de distribuição, programada` },
    { codigo: `${b}IPC`, descricao: `${b} — origem interna, programada, em dia crítico` },
    { codigo: `${b}IND`, descricao: `${b} — origem interna, não programada, não expurgável` },
    { codigo: `${b}INE`, descricao: `${b} — origem interna, não programada, em situação de emergência (fora de dia crítico)` },
    { codigo: `${b}INC`, descricao: `${b} — origem interna, não programada, em dia crítico` },
    { codigo: `${b}INO`, descricao: `${b} — origem interna, não programada, por racionamento ou ONS (fora de dia crítico)` },
    { codigo: `${b}XP`, descricao: `${b} — origem externa ao sistema de distribuição, programada` },
    { codigo: `${b}XPC`, descricao: `${b} — origem externa, programada, em dia crítico` },
    { codigo: `${b}XN`, descricao: `${b} — origem externa, não programada` },
    { codigo: `${b}XNC`, descricao: `${b} — origem externa, não programada, em dia crítico` },
  ]),
];

const campoIndicador = (i: { codigo: string; descricao: string }): Campo => ({
  nome: i.codigo.toLowerCase(),
  tipo: "decimal",
  descricao: i.descricao,
  unidade: i.codigo.startsWith("DEC") ? "horas" : "interrupções",
});

const distribuidora: Campo = { nome: "distribuidora", tipo: "texto", descricao: "Sigla da distribuidora na ANEEL (ex.: CELESC, CEMIG-D)" };
const cnpjCampo: Campo = { nome: "cnpj", tipo: "texto", descricao: "CNPJ da distribuidora, 14 dígitos — chave para cruzar com energia.balanco" };
const conjuntoId: Campo = { nome: "conjunto_id", tipo: "texto", descricao: "Código ANEEL do conjunto elétrico de unidades consumidoras" };
const conjuntoNome: Campo = { nome: "conjunto", tipo: "texto", descricao: "Nome do conjunto elétrico" };
const ano: Campo = { nome: "ano", tipo: "inteiro", descricao: "Ano de referência" };
const mes: Campo = { nome: "mes", tipo: "inteiro", descricao: "Mês de referência (1–12)" };
const periodo: Campo = { nome: "periodo", tipo: "texto", descricao: "Ano-mês de referência, AAAA-MM (campo de tempo)" };

export const energia: Dominio = {
  id: "energia",
  titulo: "Energia elétrica",
  setor: "energia",
  descricao:
    "Distribuição (continuidade do fornecimento e balanço energético das distribuidoras, ANEEL) e sistema interligado (carga e reservatórios, ONS).",
  conjuntos: [
    {
      id: "energia.continuidade",
      dominio: "energia",
      titulo: "Continuidade do fornecimento — DEC e FEC mensais por conjunto",
      descricao:
        "DEC (duração, em horas) e FEC (frequência) de interrupção por unidade consumidora, mensais, por conjunto elétrico de cada distribuidora, com a abertura por origem (interna/externa), tipo (programada/não programada) e dia crítico, como enviados à ANEEL.",
      tabela: "energia_continuidade",
      fonte: ANEEL,
      frequencia: "mensal",
      campoTempo: "periodo",
      chave: ["distribuidora", "conjunto_id", "periodo"],
      ordenacaoPadrao: ["distribuidora", "conjunto_id", "periodo"],
      tags: [
        "dec", "fec", "continuidade", "interrupção", "interrupcao", "qualidade", "falta de energia", "apagão",
        "conjunto elétrico", "distribuidora", "prodist", "aneel", "indicadores coletivos",
      ],
      avisos: [
        "Valores mensais como enviados pela distribuidora à ANEEL. Este projeto não calcula o DEC/FEC anual; para comparar com o limite anual (energia.continuidade_limites), siga o critério de apuração do PRODIST Módulo 8.",
        "Um conjunto pertence a uma distribuidora; conjuntos são redefinidos ao longo dos anos (código novo ou extinto).",
        "Para achar os conjuntos de um município, use energia.conjuntos_municipios.",
        "Os meses mais recentes chegam incompletos: as distribuidoras enviam com atraso de 1 a 3 meses. Confira quantos conjuntos o mês tem antes de concluir.",
        "As siglas são as da ANEEL e podem ser antigas (ex.: Enel SP = ELETROPAULO). Na dúvida, filtre com contem ou pelo cnpj.",
      ],
      campos: [
        distribuidora, cnpjCampo, conjuntoId, conjuntoNome, ano, mes, periodo,
        { nome: "consumidores", tipo: "inteiro", descricao: "Número de unidades consumidoras do conjunto no período", unidade: "unidades consumidoras" },
        ...INDICADORES_CONTINUIDADE.map(campoIndicador),
      ],
      exemplos: [
        {
          descricao: "DEC e FEC mensais dos conjuntos da CELESC em 2025",
          consulta: {
            conjunto: "energia.continuidade",
            campos: ["conjunto", "periodo", "consumidores", "dec", "fec"],
            filtros: { distribuidora: "CELESC" },
            inicio: "2025-01",
            fim: "2025-12",
            limite: 500,
          },
        },
        {
          descricao: "Conjuntos com DEC mensal acima de 10 horas em jan/2026",
          consulta: {
            conjunto: "energia.continuidade",
            campos: ["distribuidora", "conjunto", "dec", "decind", "decxn"],
            filtros: { periodo: "2026-01", dec: { op: "gt", valor: 10 } },
            ordenar: [{ campo: "dec", direcao: "desc" }],
          },
        },
      ],
    },
    {
      id: "energia.continuidade_limites",
      dominio: "energia",
      titulo: "Limites regulatórios anuais de DEC e FEC por conjunto",
      descricao:
        "Limites anuais de DEC (horas) e FEC (interrupções) fixados pela ANEEL para cada conjunto elétrico, inclusive anos futuros já definidos.",
      tabela: "energia_continuidade_limites",
      fonte: ANEEL,
      frequencia: "anual",
      campoTempo: "ano",
      chave: ["distribuidora", "conjunto_id", "ano"],
      ordenacaoPadrao: ["distribuidora", "conjunto_id", "ano"],
      tags: ["limite", "meta", "dec", "fec", "regulatório", "regulatorio", "continuidade", "aneel", "prodist"],
      avisos: [
        "Quando a concessão muda de distribuidora, o mesmo conjunto aparece sob as duas siglas com o mesmo limite.",
      ],
      campos: [
        distribuidora, cnpjCampo, conjuntoId, conjuntoNome,
        { ...ano, descricao: "Ano a que o limite se aplica (campo de tempo)" },
        { nome: "dec_limite", tipo: "decimal", descricao: "Limite anual de DEC", unidade: "horas" },
        { nome: "fec_limite", tipo: "decimal", descricao: "Limite anual de FEC", unidade: "interrupções" },
      ],
      exemplos: [
        {
          descricao: "Limites de 2026 dos conjuntos da CEMIG-D",
          consulta: {
            conjunto: "energia.continuidade_limites",
            filtros: { distribuidora: "CEMIG-D", ano: 2026 },
          },
        },
      ],
    },
    {
      id: "energia.conjuntos_municipios",
      dominio: "energia",
      titulo: "Conjuntos elétricos × municípios",
      descricao:
        "Ligação entre os conjuntos elétricos da ANEEL e os municípios (código IBGE). Um conjunto pode cobrir vários municípios e um município pode ter vários conjuntos.",
      tabela: "energia_conjuntos_municipios",
      fonte: ANEEL,
      frequencia: "estatico",
      chave: ["conjunto_id", "codigo_ibge"],
      ordenacaoPadrao: ["codigo_ibge", "conjunto_id"],
      tags: ["município", "municipio", "cidade", "conjunto", "código ibge", "ligação", "dec por município"],
      avisos: ["Relação vigente na data de publicação da ANEEL; conjuntos antigos podem não aparecer."],
      campos: [
        conjuntoId,
        { nome: "codigo_ibge", tipo: "texto", descricao: "Código IBGE do município, 7 dígitos — chave para territorio.municipios" },
        { nome: "municipio", tipo: "texto", descricao: "Nome do município como publicado pela ANEEL" },
        { nome: "uf", tipo: "texto", descricao: "Sigla da UF" },
      ],
      exemplos: [
        {
          descricao: "Conjuntos elétricos que atendem Florianópolis",
          consulta: { conjunto: "energia.conjuntos_municipios", filtros: { codigo_ibge: "4205407" } },
        },
      ],
    },
    {
      id: "energia.balanco",
      dominio: "energia",
      titulo: "Balanço energético mensal das distribuidoras (SAMP)",
      descricao:
        "Energia injetada, recebida, gerada, vendida, entregue e perdas na distribuição (medidas e faturadas), em kWh, por distribuidora e mês, como declarado à ANEEL no SAMP.",
      tabela: "energia_balanco",
      fonte: ANEEL,
      frequencia: "mensal",
      campoTempo: "periodo",
      chave: ["distribuidora", "cnpj", "periodo", "fluxo", "modalidade", "item", "detalhe"],
      ordenacaoPadrao: ["distribuidora", "periodo", "fluxo", "modalidade", "item"],
      tags: [
        "balanço", "balanco", "perdas", "perda de energia", "perdas na distribuição", "energia injetada",
        "mercado", "samp", "kwh", "energia vendida", "geração distribuída", "distribuidora",
      ],
      avisos: [
        "A fonte tem agentes diferentes com o mesmo CNPJ em alguns meses (ex.: ARATU-G e ELEKTRO-GER em 2007); por isso a chave inclui o nome do agente. Ao somar por CNPJ, confira o campo distribuidora.",
        "Formato longo: cada linha é um item do balanço. Filtre por fluxo/modalidade/item/detalhe antes de somar, para não contar a mesma energia duas vezes (ex.: 'Energia Injetada Total' já inclui as parcelas).",
        "As perdas aqui são as totais declaradas (fluxo 'Saldo'). A separação em técnicas e não técnicas não é publicada neste conjunto.",
        "Inclui concessionárias e permissionárias (campo classificacao).",
      ],
      campos: [
        { ...distribuidora, descricao: "Nome da distribuidora como no SAMP (sigla - razão social)" },
        cnpjCampo,
        { nome: "classificacao", tipo: "texto", descricao: "Concessionária ou permissionária" },
        ano, mes, periodo,
        { nome: "fluxo", tipo: "texto", descricao: "Disponibilidades, Requisitos ou Saldo" },
        { nome: "modalidade", tipo: "texto", descricao: "Ex.: Energia Injetada Total, Energia Vendida, Perdas na Distribuição (valor medido)" },
        { nome: "item", tipo: "texto", descricao: "Detalhe da modalidade (ex.: Perdas Totais, energia injetada nas fronteiras)" },
        { nome: "detalhe", tipo: "texto", descricao: "Medida/faturada/calculada e nível de tensão" },
        { nome: "energia_kwh", tipo: "inteiro", descricao: "Energia", unidade: "kWh" },
      ],
      exemplos: [
        {
          descricao: "Perdas totais medidas da CELESC Distribuição (CNPJ 08336783000190) mês a mês em 2025",
          consulta: {
            conjunto: "energia.balanco",
            campos: ["periodo", "item", "detalhe", "energia_kwh"],
            filtros: {
              cnpj: "08336783000190",
              modalidade: "Perdas na Distribuição (valor medido)",
            },
            inicio: "2025-01",
            fim: "2025-12",
          },
        },
        {
          descricao: "Energia injetada total da CELESC Distribuição, por mês",
          consulta: {
            conjunto: "energia.balanco",
            campos: ["periodo", "detalhe", "energia_kwh"],
            filtros: { cnpj: "08336783000190", modalidade: "Energia Injetada Total" },
            inicio: "2025-01",
          },
        },
      ],
    },
    {
      id: "energia.carga",
      dominio: "energia",
      titulo: "Carga de energia diária por subsistema (SIN)",
      descricao: "Carga de energia do Sistema Interligado Nacional por subsistema, média diária em MWmed.",
      tabela: "energia_carga",
      fonte: ONS,
      frequencia: "diaria",
      campoTempo: "data",
      chave: ["data", "subsistema_id"],
      ordenacaoPadrao: ["data", "subsistema_id"],
      tags: ["carga", "demanda", "consumo", "mwmed", "ons", "sin", "subsistema", "sudeste", "nordeste", "sul", "norte"],
      avisos: [
        "A base de medição da carga mudou em mar/2021 e mai/2023 (inclusão de geração distribuída e outras parcelas) — séries longas não são diretamente comparáveis. Veja o dicionário do ONS.",
      ],
      campos: [
        { nome: "data", tipo: "data", descricao: "Dia de referência, AAAA-MM-DD (campo de tempo)" },
        { nome: "subsistema_id", tipo: "texto", descricao: "N, NE, S ou SE (Sudeste/Centro-Oeste)" },
        { nome: "subsistema", tipo: "texto", descricao: "Nome do subsistema" },
        { nome: "carga_mwmed", tipo: "decimal", descricao: "Carga de energia, média do dia", unidade: "MWmed" },
      ],
      exemplos: [
        {
          descricao: "Carga diária do Nordeste em outubro de 2026",
          consulta: { conjunto: "energia.carga", filtros: { subsistema_id: "NE" }, inicio: "2026-10-01", fim: "2026-10-31" },
        },
      ],
    },
    {
      id: "energia.reservatorios",
      dominio: "energia",
      titulo: "Energia armazenada (EAR) diária por subsistema",
      descricao:
        "Energia armazenada nos reservatórios por subsistema: valor verificado (MWmês), capacidade máxima e percentual — o 'nível dos reservatórios' do SIN.",
      tabela: "energia_reservatorios",
      fonte: ONS,
      frequencia: "diaria",
      campoTempo: "data",
      chave: ["data", "subsistema_id"],
      ordenacaoPadrao: ["data", "subsistema_id"],
      tags: ["reservatório", "reservatorio", "ear", "energia armazenada", "nível", "hidrelétrica", "seca", "ons", "subsistema", "água"],
      avisos: ["O percentual é o publicado pelo ONS e pode passar levemente de 100% em alguns dias; mantido como publicado."],
      campos: [
        { nome: "data", tipo: "data", descricao: "Dia de referência, AAAA-MM-DD (campo de tempo)" },
        { nome: "subsistema_id", tipo: "texto", descricao: "N, NE, S ou SE" },
        { nome: "subsistema", tipo: "texto", descricao: "Nome do subsistema" },
        { nome: "ear_max_mwmes", tipo: "decimal", descricao: "Energia armazenável máxima", unidade: "MWmês" },
        { nome: "ear_mwmes", tipo: "decimal", descricao: "Energia armazenada verificada", unidade: "MWmês" },
        { nome: "ear_percentual", tipo: "decimal", descricao: "Energia armazenada verificada em % da máxima", unidade: "%" },
      ],
      exemplos: [
        {
          descricao: "Nível dos reservatórios do Sudeste no último mês",
          consulta: {
            conjunto: "energia.reservatorios",
            campos: ["data", "ear_percentual"],
            filtros: { subsistema_id: "SE" },
            ordenar: [{ campo: "data", direcao: "desc" }],
            limite: 30,
          },
        },
      ],
    },
    {
      id: "energia.usinas",
      dominio: "energia",
      titulo: "Usinas de geração (SIGA)",
      descricao:
        "Cadastro das usinas de geração centralizada do Brasil no SIGA/ANEEL: hidrelétricas (UHE, PCH, CGH), termelétricas, nucleares, eólicas e solares, com fase (operação, construção), potência, garantia física, localização e proprietários.",
      tabela: "energia_usinas",
      fonte: ANEEL,
      frequencia: "estatico",
      chave: ["codigo_ceg"],
      ordenacaoPadrao: ["uf", "tipo", "nome"],
      tags: [
        "usina", "usinas", "hidrelétrica", "hidreletrica", "hidrelétricas", "hidreletricas", "uhe", "pch", "cgh", "termelétrica", "termeletrica",
        "eólica", "eolica", "solar", "fotovoltaica", "nuclear", "geração", "geracao", "potência instalada", "potencia instalada",
        "garantia física", "garantia fisica", "siga", "parque eólico", "barragem",
      ],
      avisos: [
        "Geração centralizada outorgada pela ANEEL. Micro e minigeração distribuída (painéis em telhados) não está aqui.",
        "Coordenadas como declaradas no SIGA (um ponto por usina, em geral a casa de força). Usinas com coordenada zerada ou fora do território ficam com latitude/longitude nulas.",
        "uf = UF principal; usinas na divisa listam todos os municípios em municipios. codigo_ibge_coordenada é o município onde o ponto cai (calculado).",
        "Potência fiscalizada = em operação comercial; outorgada = autorizada. Some potência só dentro da mesma fase para não misturar o que existe com o que está previsto.",
      ],
      campos: [
        { nome: "codigo_ceg", tipo: "texto", descricao: "Código Único do Empreendimento de Geração (CEG)" },
        { nome: "nome", tipo: "texto", descricao: "Nome da usina" },
        { nome: "tipo", tipo: "texto", descricao: "Sigla: UHE, PCH, CGH, UTE, UTN, EOL, UFV" },
        { nome: "tipo_nome", tipo: "texto", descricao: "Tipo por extenso" },
        { nome: "fase", tipo: "texto", descricao: "Operação, Construção ou Construção não iniciada" },
        { nome: "origem", tipo: "texto", descricao: "Origem do combustível (Hídrica, Fóssil, Eólica, Solar, Biomassa, Nuclear…)" },
        { nome: "fonte", tipo: "texto", descricao: "Fonte (ex.: Potencial hidráulico, Gás natural, Bagaço de cana)" },
        { nome: "outorga", tipo: "texto", descricao: "Tipo de outorga (Concessão, Autorização, Registro)" },
        { nome: "uf", tipo: "texto", descricao: "UF principal" },
        { nome: "municipios", tipo: "texto", descricao: "Municípios do empreendimento, como no SIGA" },
        { nome: "codigo_ibge_coordenada", tipo: "texto", descricao: "Município IBGE onde a coordenada cai (calculado)" },
        { nome: "potencia_outorgada_mw", tipo: "decimal", descricao: "Potência outorgada", unidade: "MW" },
        { nome: "potencia_fiscalizada_mw", tipo: "decimal", descricao: "Potência fiscalizada (em operação)", unidade: "MW" },
        { nome: "garantia_fisica_mw", tipo: "decimal", descricao: "Garantia física", unidade: "MWmed" },
        { nome: "geracao_qualificada", tipo: "booleano", descricao: "Cogeração qualificada" },
        { nome: "entrada_operacao", tipo: "data", descricao: "Data de entrada em operação" },
        { nome: "latitude", tipo: "decimal", descricao: "Latitude", unidade: "graus decimais" },
        { nome: "longitude", tipo: "decimal", descricao: "Longitude", unidade: "graus decimais" },
        { nome: "sub_bacia", tipo: "texto", descricao: "Sub-bacia hidrográfica (hidrelétricas)" },
        { nome: "proprietarios", tipo: "texto", descricao: "Proprietários e participação, como no SIGA" },
      ],
      exemplos: [
        {
          descricao: "Hidrelétricas (UHE) em operação no Pará, maiores primeiro",
          consulta: {
            conjunto: "energia.usinas",
            campos: ["nome", "potencia_fiscalizada_mw", "municipios", "latitude", "longitude"],
            filtros: { uf: "PA", tipo: "UHE", fase: "Operação" },
            ordenar: [{ campo: "potencia_fiscalizada_mw", direcao: "desc" }],
          },
        },
        {
          descricao: "Parques eólicos a até 50 km de Natal",
          consulta: { conjunto: "energia.usinas", campos: ["nome", "potencia_fiscalizada_mw", "fase"], filtros: { tipo: "EOL" }, perto: { latitude: -5.79, longitude: -35.21, raio_km: 50 } },
        },
      ],
    },
  ],
};
