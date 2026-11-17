import { IBGE, SGB } from "./fontes.ts";
import type { Dominio } from "./tipos.ts";

export const territorio: Dominio = {
  id: "territorio",
  titulo: "Território",
  setor: "territorio",
  descricao:
    "Base territorial comum a todos os domínios. O código IBGE do município (7 dígitos) é a chave de junção com energia, água e saneamento.",
  conjuntos: [
    {
      id: "territorio.municipios",
      dominio: "territorio",
      titulo: "Municípios do Brasil",
      descricao:
        "Todos os municípios (5.571 na divisão vigente) com UF, região, região imediata e intermediária (IBGE) e população residente do Censo 2022.",
      tabela: "territorio_municipios",
      fonte: IBGE,
      frequencia: "estatico",
      chave: ["codigo_ibge"],
      ordenacaoPadrao: ["codigo_ibge"],
      tags: ["município", "cidade", "uf", "estado", "região", "população", "censo", "ibge", "código ibge"],
      avisos: [
        "População = Censo Demográfico 2022 (população residente), não estimativa anual.",
        "Municípios instalados depois do Censo 2022 (ex.: Boa Esperança do Norte/MT) vêm com populacao_2022 = null.",
      ],
      campos: [
        { nome: "codigo_ibge", tipo: "texto", descricao: "Código IBGE do município, 7 dígitos" },
        { nome: "nome", tipo: "texto", descricao: "Nome do município" },
        { nome: "uf", tipo: "texto", descricao: "Sigla da UF" },
        { nome: "uf_nome", tipo: "texto", descricao: "Nome da UF" },
        { nome: "codigo_uf", tipo: "texto", descricao: "Código IBGE da UF, 2 dígitos" },
        { nome: "regiao", tipo: "texto", descricao: "Sigla da grande região (N, NE, CO, SE, S)" },
        { nome: "regiao_nome", tipo: "texto", descricao: "Nome da grande região" },
        { nome: "regiao_imediata", tipo: "texto", descricao: "Região geográfica imediata (IBGE 2017)" },
        { nome: "regiao_intermediaria", tipo: "texto", descricao: "Região geográfica intermediária (IBGE 2017)" },
        { nome: "populacao_2022", tipo: "inteiro", descricao: "População residente, Censo 2022", unidade: "pessoas" },
      ],
      exemplos: [
        {
          descricao: "Municípios de Santa Catarina com mais de 100 mil habitantes",
          consulta: {
            conjunto: "territorio.municipios",
            filtros: { uf: "SC", populacao_2022: { op: "gte", valor: 100000 } },
            ordenar: [{ campo: "populacao_2022", direcao: "desc" }],
          },
        },
        {
          descricao: "Achar o código IBGE de um município pelo nome",
          consulta: {
            conjunto: "territorio.municipios",
            campos: ["codigo_ibge", "nome", "uf"],
            filtros: { nome: { op: "contem", valor: "florianopolis" } },
          },
        },
      ],
    },
    {
      id: "territorio.ufs",
      dominio: "territorio",
      titulo: "Unidades da Federação",
      descricao: "As 27 UFs com região e população residente do Censo 2022 (soma dos municípios).",
      tabela: "territorio_ufs",
      fonte: IBGE,
      frequencia: "estatico",
      chave: ["uf"],
      ordenacaoPadrao: ["codigo_uf"],
      tags: ["uf", "estado", "região", "população", "ibge"],
      campos: [
        { nome: "codigo_uf", tipo: "texto", descricao: "Código IBGE da UF, 2 dígitos" },
        { nome: "uf", tipo: "texto", descricao: "Sigla da UF" },
        { nome: "uf_nome", tipo: "texto", descricao: "Nome da UF" },
        { nome: "regiao", tipo: "texto", descricao: "Sigla da grande região" },
        { nome: "regiao_nome", tipo: "texto", descricao: "Nome da grande região" },
        { nome: "municipios", tipo: "inteiro", descricao: "Quantidade de municípios" },
        { nome: "populacao_2022", tipo: "inteiro", descricao: "População residente, Censo 2022", unidade: "pessoas" },
      ],
      exemplos: [
        {
          descricao: "UFs do Nordeste por população",
          consulta: {
            conjunto: "territorio.ufs",
            filtros: { regiao: "NE" },
            ordenar: [{ campo: "populacao_2022", direcao: "desc" }],
          },
        },
      ],
    },
    {
      id: "territorio.malha_municipios",
      dominio: "territorio",
      titulo: "Malha municipal (polígonos dos municípios)",
      descricao:
        "Polígono de cada município em GeoJSON (WGS84), malha vigente do IBGE em qualidade intermediária — para mapas e cruzamentos espaciais.",
      tabela: "territorio_malha",
      fonte: IBGE,
      frequencia: "estatico",
      chave: ["codigo_ibge"],
      ordenacaoPadrao: ["codigo_ibge"],
      tags: ["malha", "polígono", "poligono", "limite municipal", "geojson", "mapa", "fronteira", "ibge"],
      avisos: [
        "A geometria só vem quando pedida em campos (\"geometria\"). Peça poucos municípios por vez: cada polígono tem dezenas de KB.",
        "Qualidade intermediária (simplificada): serve para mapas e associação aproximada, não para medição de área ou limites legais.",
      ],
      campos: [
        { nome: "codigo_ibge", tipo: "texto", descricao: "Código IBGE do município, 7 dígitos" },
        { nome: "nome", tipo: "texto", descricao: "Nome do município" },
        { nome: "uf", tipo: "texto", descricao: "Sigla da UF" },
        { nome: "geometria", tipo: "geometria", descricao: "Polígono do município em GeoJSON (WGS84)" },
      ],
      exemplos: [
        {
          descricao: "Polígono de Florianópolis",
          consulta: { conjunto: "territorio.malha_municipios", campos: ["codigo_ibge", "nome", "geometria"], filtros: { codigo_ibge: "4205407" } },
        },
      ],
    },
    {
      id: "territorio.risco_setores",
      dominio: "territorio",
      titulo: "Setores de risco geológico e hidrológico (SGB)",
      descricao:
        "Setores de risco alto e muito alto mapeados pelo Serviço Geológico do Brasil: tipologia (deslizamento, inundação, erosão…), grau de risco e vulnerabilidade, edificações, domicílios e pessoas expostas, descrição, intervenções sugeridas e polígono.",
      tabela: "territorio_risco_setores",
      fonte: SGB,
      frequencia: "estatico",
      campoTempo: "data_setorizacao",
      chave: ["id_sgb"],
      ordenacaoPadrao: ["uf", "municipio", "setor"],
      tags: [
        "risco", "área de risco", "setor de risco", "deslizamento", "inundação", "inundacao", "enchente", "enxurrada",
        "alagamento", "erosão", "queda de blocos", "desastre", "defesa civil", "sgb", "cprm", "cobrade", "geológico",
      ],
      avisos: [
        "O mesmo setor pode aparecer em mais de uma linha (polígono em partes, com os mesmos números) e o mesmo código pode se repetir em municípios diferentes. Antes de somar pessoas ou domicílios, agrupe por setor + codigo_ibge.",
        "Cobertura: só os municípios mapeados pelo SGB. Muitos municípios têm mapeamento próprio ou estadual (ex.: Petrópolis/RJ) que não está aqui — ausência de setor não significa ausência de risco.",
        "Cada setor tem a data do seu mapeamento (data_setorizacao); municípios mapeados há anos podem estar desatualizados.",
        "latitude/longitude são o centróide calculado do polígono — ponto de referência, não oficial.",
        "A geometria só vem quando pedida em campos (\"geometria\").",
      ],
      campos: [
        { nome: "id_sgb", tipo: "texto", descricao: "Identificador único do registro na camada do SGB" },
        { nome: "setor", tipo: "texto", descricao: "Código do setor (ex.: RS_TRAMAND_SR_003_CPRM)" },
        { nome: "uf", tipo: "texto", descricao: "Sigla da UF" },
        { nome: "codigo_ibge", tipo: "texto", descricao: "Código IBGE do município" },
        { nome: "municipio", tipo: "texto", descricao: "Município, como publicado" },
        { nome: "data_setorizacao", tipo: "data", descricao: "Data do mapeamento do setor (campo de tempo)" },
        { nome: "local", tipo: "texto", descricao: "Logradouro/bairro de referência" },
        { nome: "tipologia", tipo: "texto", descricao: "Tipologia principal (Deslizamento, Inundação, Erosão, Enxurrada, Queda, Enchente, Rastejo, Alagamento…)" },
        { nome: "tipologia_especifica", tipo: "texto", descricao: "Detalhe da tipologia principal" },
        { nome: "tipologias", tipo: "texto", descricao: "Todas as tipologias do setor, separadas por ';'" },
        { nome: "cobrade", tipo: "texto", descricao: "Códigos COBRADE (classificação brasileira de desastres), separados por ';'" },
        { nome: "grau_risco", tipo: "texto", descricao: "Médio, Alto ou Muito alto" },
        { nome: "grau_vulnerabilidade", tipo: "texto", descricao: "Grau de vulnerabilidade" },
        { nome: "edificacoes", tipo: "inteiro", descricao: "Edificações no setor", unidade: "edificações" },
        { nome: "domicilios", tipo: "inteiro", descricao: "Domicílios no setor", unidade: "domicílios" },
        { nome: "pessoas", tipo: "inteiro", descricao: "Pessoas estimadas no setor", unidade: "pessoas" },
        { nome: "descricao", tipo: "texto", descricao: "Descrição técnica do setor" },
        { nome: "ocupacao", tipo: "texto", descricao: "Observações sobre a ocupação" },
        { nome: "intervencoes_sugeridas", tipo: "texto", descricao: "Intervenções sugeridas pelo SGB" },
        { nome: "orgao_executor", tipo: "texto", descricao: "Órgão que executou o mapeamento" },
        { nome: "latitude", tipo: "decimal", descricao: "Latitude do centróide (calculada)", unidade: "graus decimais" },
        { nome: "longitude", tipo: "decimal", descricao: "Longitude do centróide (calculada)", unidade: "graus decimais" },
        { nome: "geometria", tipo: "geometria", descricao: "Polígono do setor em GeoJSON (WGS84)" },
      ],
      exemplos: [
        {
          descricao: "Setores de risco muito alto de inundação no Rio Grande do Sul",
          consulta: {
            conjunto: "territorio.risco_setores",
            campos: ["municipio", "setor", "local", "pessoas", "data_setorizacao"],
            filtros: { uf: "RS", tipologia: "Inundação", grau_risco: "Muito alto" },
            ordenar: [{ campo: "pessoas", direcao: "desc" }],
          },
        },
        {
          descricao: "Setores de risco de Nova Friburgo (RJ) com o polígono",
          consulta: {
            conjunto: "territorio.risco_setores",
            campos: ["setor", "tipologia", "grau_risco", "pessoas", "geometria"],
            filtros: { codigo_ibge: "3303401" },
            limite: 20,
          },
        },
        {
          descricao: "Setores com deslizamento entre as tipologias, mapeados desde 2023",
          consulta: {
            conjunto: "territorio.risco_setores",
            campos: ["uf", "municipio", "setor", "tipologias", "grau_risco"],
            filtros: { tipologias: { op: "contem", valor: "deslizamento" } },
            inicio: "2023-01-01",
          },
        },
      ],
    },
  ],
};
