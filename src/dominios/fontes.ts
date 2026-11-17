import type { Fonte } from "./tipos.ts";

export const IBGE: Fonte = {
  id: "ibge",
  nome: "IBGE — Instituto Brasileiro de Geografia e Estatística",
  url: "https://servicodados.ibge.gov.br/api/docs",
  licenca: "Dados públicos (Lei 12.527/2011 e Decreto 8.777/2016)",
  licencaUrl: "https://www.ibge.gov.br/acesso-informacao/institucional/termos-de-uso.html",
  atribuicao: "Fonte: IBGE",
};

export const ANEEL: Fonte = {
  id: "aneel",
  nome: "ANEEL — Agência Nacional de Energia Elétrica",
  url: "https://dadosabertos.aneel.gov.br",
  licenca: "Open Database License (ODbL)",
  licencaUrl: "https://opendatacommons.org/licenses/odbl/",
  atribuicao: "Fonte: ANEEL — Dados Abertos (ODbL)",
};

export const ONS: Fonte = {
  id: "ons",
  nome: "ONS — Operador Nacional do Sistema Elétrico",
  url: "https://dados.ons.org.br",
  licenca: "Creative Commons Atribuição (CC-BY)",
  licencaUrl: "http://www.opendefinition.org/licenses/cc-by",
  atribuicao: "Fonte: ONS — Dados Abertos (CC-BY)",
};

export const SINISA: Fonte = {
  id: "sinisa",
  nome: "SINISA — Sistema Nacional de Informações em Saneamento Básico (Ministério das Cidades)",
  url: "https://www.gov.br/cidades/pt-br/acesso-a-informacao/acoes-e-programas/saneamento/sinisa",
  licenca:
    "Dados públicos do Governo Federal (Lei 12.527/2011, Decreto 8.777/2016). O portal gov.br indica CC BY-ND 3.0 para seu conteúdo; não há termo específico para as planilhas.",
  licencaUrl: "https://creativecommons.org/licenses/by-nd/3.0/deed.pt_BR",
  atribuicao: "Fonte: SINISA / Ministério das Cidades",
};

export const ANA: Fonte = {
  id: "ana",
  nome: "ANA — Agência Nacional de Águas e Saneamento Básico (SNIRH)",
  url: "https://dadosabertos.ana.gov.br",
  licenca: "É permitida a reprodução de dados e de informações, desde que citada a fonte (termo da ANA)",
  licencaUrl: "https://dadosabertos.ana.gov.br/datasets/cbdda4679ff941c9878efa8200491627",
  atribuicao: "Fonte: ANA / SNIRH",
};

export const SGB: Fonte = {
  id: "sgb",
  nome: "SGB — Serviço Geológico do Brasil (CPRM)",
  url: "https://geoportal.sgb.gov.br",
  licenca:
    "Dado público do Governo Federal; o SGB não publica termo de licença específico para a setorização de risco — a confirmar com o órgão. Cite a fonte.",
  licencaUrl: "https://geoportal.sgb.gov.br",
  atribuicao: "Fonte: SGB/CPRM — Setorização de Áreas de Risco Geológico",
};

export const ANA_HIDROWEB: Fonte = {
  id: "ana-hidroweb",
  nome: "ANA — Agência Nacional de Águas e Saneamento Básico (Hidroweb)",
  url: "https://www.snirh.gov.br/hidroweb",
  licenca: "É permitida a reprodução de dados e de informações, desde que citada a fonte (termo da ANA). O serviço exige cadastro gratuito.",
  licencaUrl: "https://dadosabertos.ana.gov.br/datasets/cbdda4679ff941c9878efa8200491627",
  atribuicao: "Fonte: ANA / Hidroweb",
};
