import { ANA, ANA_HIDROWEB } from "./fontes.ts";
import type { Campo, Conjunto, Dominio } from "./tipos.ts";

/** Avisos comuns às séries do Hidroweb. */
const AVISOS_HIDROWEB = [
  "Só as estações escolhidas por quem coleta (lista em config/hidroweb-estacoes.json), não a rede inteira. A proveniência diz quais. Para descobrir estações use agua.estacoes.",
  "nivel_consistencia: 'bruto' é o dado como medido; 'consistido' foi revisado pela ANA (às vezes anos depois). O mesmo dia pode ter os dois — filtre por nivel_consistencia para não contar duas vezes.",
  "status é o código de qualidade da base HIDRO, repassado como veio. A API não publica a tabela de significados; não interpretamos.",
  "Série convencional é consolidada com atraso de anos; o recente está em agua.telemetria.",
];

function serieDiaria(
  id: string, titulo: string, descricao: string, coluna: string, unidade: string, tags: string[], exemplo: Conjunto["exemplos"][number],
): Conjunto {
  const campos: Campo[] = [
    { nome: "codigo", tipo: "texto", descricao: "Código da estação (o mesmo de agua.estacoes)" },
    { nome: "data", tipo: "data", descricao: "Dia" },
    { nome: coluna, tipo: "decimal", descricao: titulo, unidade },
    { nome: "status", tipo: "texto", descricao: "Código de qualidade do dia na base HIDRO (como veio da ANA)" },
    { nome: "nivel_consistencia", tipo: "texto", descricao: "bruto ou consistido" },
    { nome: "tipo_medicao", tipo: "texto", descricao: "Código do tipo de medição na base HIDRO (como veio da ANA)" },
    { nome: "atualizado_em", tipo: "data", descricao: "Última alteração do mês na base HIDRO" },
  ];
  return {
    id, dominio: "agua", titulo, descricao,
    tabela: id.replace(".", "_"),
    fonte: ANA_HIDROWEB,
    frequencia: "diaria",
    campoTempo: "data",
    podeFicarVazio: true,
    chave: ["codigo", "data", "nivel_consistencia", "tipo_medicao"],
    ordenacaoPadrao: ["codigo", "data", "nivel_consistencia"],
    tags,
    avisos: AVISOS_HIDROWEB,
    campos,
    exemplos: [exemplo],
  };
}


export const agua: Dominio = {
  id: "agua",
  titulo: "Recursos hídricos",
  setor: "agua",
  descricao:
    "Rede de monitoramento hidrometeorológico da ANA: onde estão as estações de nível, vazão e chuva e, para as estações escolhidas, as séries diárias (Hidroweb) e a telemetria recente.",
  conjuntos: [
    {
      id: "agua.estacoes",
      dominio: "agua",
      titulo: "Estações da Rede Hidrometeorológica Nacional",
      descricao:
        "Inventário das estações fluviométricas (nível e vazão de rios) e pluviométricas (chuva) cadastradas no SNIRH/ANA, com localização, rio, bacia, responsável, o que cada uma mede e se é telemétrica.",
      tabela: "agua_estacoes",
      fonte: ANA,
      frequencia: "estatico",
      chave: ["codigo"],
      ordenacaoPadrao: ["codigo"],
      tags: [
        "estação", "estacao", "régua", "regua", "fluviométrica", "fluviometrica", "pluviométrica", "pluviometrica",
        "rio", "bacia", "nível", "vazão", "vazao", "chuva", "hidrologia", "ana", "snirh", "hidroweb",
        "cheia", "enchente",
      ],
      avisos: [
        "Inventário: diz onde estão as estações e o que medem. As séries ficam em agua.cotas, agua.vazoes, agua.chuvas e agua.telemetria (só das estações coletadas).",
        "A base HIDRO usa códigos de município próprios. codigo_ibge = município registrado pela ANA; codigo_ibge_coordenada = onde o ponto cai na malha do IBGE. Os dois divergem em ~16% das estações, quase sempre em divisas (rios costumam ser divisa municipal).",
        "A rede inclui estações de outros responsáveis (INMET, estados, concessionárias) e de países vizinhos na mesma bacia.",
      ],
      campos: [
        { nome: "codigo", tipo: "texto", descricao: "Código da estação na base HIDRO (o mesmo do Hidroweb)" },
        { nome: "nome", tipo: "texto", descricao: "Nome da estação" },
        { nome: "tipo", tipo: "texto", descricao: "Fluviométrica ou Pluviométrica" },
        { nome: "operando", tipo: "booleano", descricao: "Em operação" },
        { nome: "codigo_adicional", tipo: "texto", descricao: "Código adicional (ex.: código de outro órgão)" },
        { nome: "latitude", tipo: "decimal", descricao: "Latitude", unidade: "graus decimais" },
        { nome: "longitude", tipo: "decimal", descricao: "Longitude", unidade: "graus decimais" },
        { nome: "altitude_m", tipo: "decimal", descricao: "Altitude", unidade: "m" },
        { nome: "area_drenagem_km2", tipo: "decimal", descricao: "Área de drenagem (fluviométricas)", unidade: "km²" },
        { nome: "bacia", tipo: "texto", descricao: "Bacia hidrográfica" },
        { nome: "sub_bacia", tipo: "texto", descricao: "Sub-bacia" },
        { nome: "rio", tipo: "texto", descricao: "Rio (fluviométricas)" },
        { nome: "municipio", tipo: "texto", descricao: "Município como na base HIDRO" },
        { nome: "municipio_codigo_hidro", tipo: "texto", descricao: "Código do município na base HIDRO (não é o IBGE)" },
        { nome: "responsavel", tipo: "texto", descricao: "Sigla do responsável pela estação" },
        { nome: "operadora", tipo: "texto", descricao: "Sigla da operadora" },
        { nome: "escala_nivel", tipo: "booleano", descricao: "Tem régua (escala) de nível" },
        { nome: "registrador_nivel", tipo: "booleano", descricao: "Tem registrador de nível" },
        { nome: "descarga_liquida", tipo: "booleano", descricao: "Faz medição de descarga líquida (vazão)" },
        { nome: "qualidade_agua", tipo: "booleano", descricao: "Mede qualidade da água" },
        { nome: "pluviometro", tipo: "booleano", descricao: "Tem pluviômetro convencional" },
        { nome: "registrador_chuva", tipo: "booleano", descricao: "Tem registrador de chuva" },
        { nome: "telemetrica", tipo: "booleano", descricao: "Transmite dados por telemetria" },
        { nome: "telemetrica_inicio", tipo: "data", descricao: "Início da telemetria" },
        { nome: "atualizado_em", tipo: "data", descricao: "Última alteração do cadastro" },
        { nome: "uf", tipo: "texto", descricao: "Sigla da UF (null fora do Brasil)" },
        { nome: "uf_nome", tipo: "texto", descricao: "UF ou país como na base HIDRO" },
        { nome: "codigo_ibge", tipo: "texto", descricao: "Código IBGE do município registrado pela ANA (associado por UF + nome; sem correspondência, pela coordenada)" },
        { nome: "codigo_ibge_metodo", tipo: "texto", descricao: "Como codigo_ibge foi associado: nome ou coordenada" },
        { nome: "codigo_ibge_coordenada", tipo: "texto", descricao: "Município cujo polígono (malha IBGE) contém a coordenada — calculado; pode diferir do registrado perto de divisas e rios" },
      ],
      exemplos: [
        {
          descricao: "Estações fluviométricas telemétricas em operação no Rio Grande do Sul",
          consulta: {
            conjunto: "agua.estacoes",
            campos: ["codigo", "nome", "rio", "municipio", "latitude", "longitude"],
            filtros: { uf: "RS", tipo: "Fluviométrica", operando: true, telemetrica: true },
            limite: 200,
          },
        },
        {
          descricao: "Estações de um município pelo código IBGE (Blumenau)",
          consulta: {
            conjunto: "agua.estacoes",
            campos: ["codigo", "nome", "tipo", "rio", "operando", "telemetrica"],
            filtros: { codigo_ibge: "4202404" },
          },
        },
        {
          descricao: "Estações no Rio São Francisco",
          consulta: {
            conjunto: "agua.estacoes",
            campos: ["codigo", "nome", "uf", "municipio", "operando"],
            filtros: { rio: { op: "contem", valor: "rio sao francisco" }, tipo: "Fluviométrica" },
          },
        },
      ],
    },
    serieDiaria(
      "agua.cotas",
      "Cota diária",
      "Série histórica diária do nível do rio (cota na régua) das estações fluviométricas escolhidas, do Hidroweb/ANA. Média diária, bruta e consistida.",
      "cota_cm", "cm",
      ["cota", "cotas", "diária", "diário", "nível diário", "nivel diario", "série histórica", "serie historica", "cheia", "enchente", "seca", "hidroweb", "fluviométrica"],
      {
        descricao: "Cota consistida de Manaus (Rio Negro) na cheia de 2012",
        consulta: { conjunto: "agua.cotas", filtros: { codigo: "14990000", nivel_consistencia: "consistido" }, inicio: "2012-05-01", fim: "2012-07-31", limite: 100 },
      },
    ),
    serieDiaria(
      "agua.vazoes",
      "Vazão diária",
      "Série histórica diária de vazão (descarga) das estações fluviométricas escolhidas, do Hidroweb/ANA, bruta e consistida. A ANA obtém a vazão diária da cota pela curva-chave.",
      "vazao_m3s", "m³/s",
      ["vazão", "vazao", "diária", "diário", "vazões", "vazoes", "descarga", "vazão diária", "série histórica", "serie historica", "hidroweb"],
      {
        descricao: "Vazão consistida do São Francisco em Juazeiro, em 2001",
        consulta: { conjunto: "agua.vazoes", filtros: { codigo: "48020000", nivel_consistencia: "consistido" }, inicio: "2001-01-01", fim: "2001-12-31", limite: 365 },
      },
    ),
    serieDiaria(
      "agua.chuvas",
      "Chuva diária",
      "Série histórica diária de chuva (precipitação) das estações pluviométricas escolhidas, do Hidroweb/ANA, bruta e consistida.",
      "chuva_mm", "mm",
      ["chuva", "chuvas", "diária", "diário", "chuva diária", "precipitação", "precipitacao", "pluviometria", "série histórica", "serie historica", "hidroweb"],
      {
        descricao: "Chuva diária em Porto Alegre em maio de 2024 (dado bruto)",
        consulta: { conjunto: "agua.chuvas", filtros: { codigo: "3051011", nivel_consistencia: "bruto" }, inicio: "2024-05-01", fim: "2024-05-31", limite: 31 },
      },
    ),
    {
      id: "agua.telemetria",
      dominio: "agua",
      titulo: "Telemetria (chuva, nível e vazão recentes)",
      descricao:
        "Medições automáticas recentes das estações telemétricas escolhidas — chuva, cota e vazão adotadas pela ANA, em intervalos de 15 min a 1 h. É o dado de 'agora', sem consistência.",
      tabela: "agua_telemetria",
      fonte: ANA_HIDROWEB,
      frequencia: "horaria",
      campoTempo: "data_hora",
      podeFicarVazio: true,
      chave: ["codigo", "data_hora"],
      ordenacaoPadrao: ["codigo", "data_hora"],
      tags: ["telemetria", "telemétrica", "tempo real", "agora", "recente", "última leitura", "ultima leitura", "nível atual", "nivel atual", "hidroweb"],
      avisos: [
        "Dado telemétrico adotado pela ANA, sem consistência: pode ter falhas e picos espúrios.",
        "data_hora vem como texto AAAA-MM-DD HH:MM:SS, como publicada pela ANA; a API não informa o fuso. Em inicio/fim, para incluir o dia inteiro use fim: \"AAAA-MM-DD 23:59:59\".",
        "Só as estações escolhidas por quem coleta, nos últimos N dias (proveniência). Para o histórico use agua.cotas, agua.vazoes e agua.chuvas.",
        "Os campos *_status são códigos da ANA repassados como vieram; não interpretamos.",
        "A ANA devolve a telemetria de alguns pluviômetros sob o código da estação fluviométrica do mesmo posto automático (ex.: 549013 aparece como 29050000). Guardamos o código que a ANA devolveu; a proveniência lista esses casos.",
      ],
      campos: [
        { nome: "codigo", tipo: "texto", descricao: "Código da estação (o mesmo de agua.estacoes)" },
        { nome: "data_hora", tipo: "texto", descricao: "Data e hora da medição, AAAA-MM-DD HH:MM:SS como publicada pela ANA (fuso não informado)" },
        { nome: "chuva_mm", tipo: "decimal", descricao: "Chuva no intervalo", unidade: "mm" },
        { nome: "chuva_status", tipo: "texto", descricao: "Código de status da chuva (ANA)" },
        { nome: "cota_cm", tipo: "decimal", descricao: "Cota (nível na régua)", unidade: "cm" },
        { nome: "cota_status", tipo: "texto", descricao: "Código de status da cota (ANA)" },
        { nome: "vazao_m3s", tipo: "decimal", descricao: "Vazão", unidade: "m³/s" },
        { nome: "vazao_status", tipo: "texto", descricao: "Código de status da vazão (ANA)" },
        { nome: "atualizado_em", tipo: "texto", descricao: "Quando a ANA gravou/atualizou o registro (AAAA-MM-DD HH:MM:SS)" },
      ],
      exemplos: [
        {
          descricao: "Últimas leituras do Guaíba no Cais Mauá",
          consulta: {
            conjunto: "agua.telemetria",
            campos: ["data_hora", "cota_cm", "chuva_mm"],
            filtros: { codigo: "87450004" },
            ordenar: [{ campo: "data_hora", direcao: "desc" }],
            limite: 24,
          },
        },
      ],
    },
  ],
};
