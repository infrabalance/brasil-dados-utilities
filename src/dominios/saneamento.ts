import { SINISA } from "./fontes.ts";
import type { Dominio } from "./tipos.ts";

export const saneamento: Dominio = {
  id: "saneamento",
  titulo: "Saneamento — abastecimento de água e esgotamento sanitário",
  setor: "saneamento",
  descricao:
    "Indicadores oficiais do SINISA por município e ano de referência: atendimento, perdas, consumo, qualidade do serviço e gestão financeira dos prestadores de água e esgoto.",
  conjuntos: [
    {
      id: "saneamento.indicadores",
      dominio: "saneamento",
      titulo: "Indicadores do SINISA por município (água e esgoto)",
      descricao:
        "Valores dos indicadores do SINISA por município, como publicados pelo Ministério das Cidades. Formato longo: uma linha por município, ano e indicador. Use saneamento.dicionario para ver os códigos.",
      tabela: "saneamento_indicadores",
      fonte: SINISA,
      frequencia: "anual",
      campoTempo: "ano",
      chave: ["ano", "modulo", "codigo_ibge", "indicador"],
      ordenacaoPadrao: ["ano", "modulo", "codigo_ibge", "indicador"],
      tags: [
        "saneamento", "água", "agua", "esgoto", "perdas de água", "perda de agua", "perdas na distribuição",
        "atendimento", "cobertura", "abastecimento", "coleta", "tratamento de esgoto", "sinisa", "snis",
        "prestador", "companhia", "casan", "sabesp", "tarifa", "consumo per capita", "iag2013", "ies0001",
      ],
      avisos: [
        "Ano de referência = ano a que o dado se refere; a publicação sai no fim do ano seguinte (ex.: referência 2024 publicada em dez/2025).",
        "Valores como publicados pelo SINISA. Quando o indicador não foi calculado, valor = null e o motivo está em situacao.",
        "O SINISA substituiu o SNIS a partir da referência 2023; não compare diretamente com séries antigas do SNIS (códigos e definições mudaram).",
        "Esgoto disponível só a partir da referência 2024 neste conjunto; água desde 2023.",
        "Quando há mais de um prestador no município, prestador, sigla e abrangência vêm juntos, separados por ';'.",
      ],
      campos: [
        { nome: "ano", tipo: "inteiro", descricao: "Ano de referência (campo de tempo)" },
        { nome: "modulo", tipo: "texto", descricao: "agua ou esgoto" },
        { nome: "codigo_ibge", tipo: "texto", descricao: "Código IBGE do município, 7 dígitos" },
        { nome: "municipio", tipo: "texto", descricao: "Município, como publicado" },
        { nome: "uf", tipo: "texto", descricao: "Sigla da UF" },
        { nome: "macrorregiao", tipo: "texto", descricao: "Grande região" },
        { nome: "capital", tipo: "texto", descricao: "'Sim' se for capital" },
        { nome: "rm_ride", tipo: "texto", descricao: "Região metropolitana ou RIDE" },
        { nome: "natureza_juridica", tipo: "texto", descricao: "Natureza jurídica do prestador (ex.: Sociedade de economia mista, Autarquia, Empresa privada)" },
        { nome: "abrangencia", tipo: "texto", descricao: "Local ou Regional (só a partir de 2024)" },
        { nome: "prestador", tipo: "texto", descricao: "Nome do prestador do serviço" },
        { nome: "prestador_sigla", tipo: "texto", descricao: "Sigla do prestador (ex.: CASAN, SABESP, SAAE)" },
        { nome: "indicador", tipo: "texto", descricao: "Código SINISA do indicador (ex.: IAG2013 = perdas totais de água na distribuição)" },
        { nome: "indicador_nome", tipo: "texto", descricao: "Nome do indicador" },
        { nome: "grupo", tipo: "texto", descricao: "Atendimento, Estruturais e Operacionais, Qualidade, Administrativo e Financeiro" },
        { nome: "unidade", tipo: "texto", descricao: "Unidade do indicador, como publicada" },
        { nome: "valor", tipo: "decimal", descricao: "Valor do indicador (null quando não calculado)" },
        { nome: "situacao", tipo: "texto", descricao: "Motivo publicado quando o indicador não foi calculado" },
      ],
      exemplos: [
        {
          descricao: "Perdas totais de água na distribuição (IAG2013) nas capitais em 2024",
          consulta: {
            conjunto: "saneamento.indicadores",
            campos: ["municipio", "uf", "prestador_sigla", "valor", "unidade"],
            filtros: { ano: 2024, indicador: "IAG2013", capital: "Sim" },
            ordenar: [{ campo: "valor", direcao: "desc" }],
          },
        },
        {
          descricao: "Atendimento de água (IAG0001) e esgoto (IES0001) em Florianópolis",
          consulta: {
            conjunto: "saneamento.indicadores",
            campos: ["ano", "modulo", "indicador", "indicador_nome", "valor", "unidade"],
            filtros: { codigo_ibge: "4205407", indicador: ["IAG0001", "IES0001"] },
          },
        },
        {
          descricao: "Municípios atendidos pela CASAN com perdas de água acima de 40% em 2024",
          consulta: {
            conjunto: "saneamento.indicadores",
            campos: ["municipio", "valor"],
            filtros: {
              ano: 2024, indicador: "IAG2013", prestador_sigla: "CASAN", valor: { op: "gt", valor: 40 },
            },
            ordenar: [{ campo: "valor", direcao: "desc" }],
          },
        },
      ],
    },
    {
      id: "saneamento.dicionario",
      dominio: "saneamento",
      titulo: "Dicionário dos indicadores do SINISA",
      descricao: "Código, nome, grupo, unidade e anos disponíveis de cada indicador de água e esgoto.",
      tabela: "saneamento_dicionario",
      fonte: SINISA,
      frequencia: "estatico",
      chave: ["modulo", "indicador"],
      ordenacaoPadrao: ["modulo", "indicador"],
      tags: ["dicionário", "dicionario", "indicadores", "códigos", "glossário", "sinisa", "saneamento", "perdas", "atendimento"],
      avisos: [
        "As definições completas e a forma de cálculo estão nos glossários oficiais do SINISA (gov.br/cidades).",
      ],
      campos: [
        { nome: "modulo", tipo: "texto", descricao: "agua ou esgoto" },
        { nome: "indicador", tipo: "texto", descricao: "Código SINISA" },
        { nome: "nome", tipo: "texto", descricao: "Nome do indicador" },
        { nome: "grupo", tipo: "texto", descricao: "Grupo do indicador" },
        { nome: "unidade", tipo: "texto", descricao: "Unidade" },
        { nome: "anos", tipo: "texto", descricao: "Anos de referência disponíveis neste servidor" },
      ],
      exemplos: [
        {
          descricao: "Indicadores de perdas de água",
          consulta: { conjunto: "saneamento.dicionario", filtros: { nome: { op: "contem", valor: "perdas" } } },
        },
        {
          descricao: "Todos os indicadores de esgoto do grupo Atendimento",
          consulta: { conjunto: "saneamento.dicionario", filtros: { modulo: "esgoto", grupo: "Atendimento" } },
        },
      ],
    },
  ],
};
