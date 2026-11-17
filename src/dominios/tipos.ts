export type Setor = "energia" | "agua" | "saneamento" | "territorio";
export type TipoCampo = "texto" | "inteiro" | "decimal" | "data" | "booleano" | "geometria";

export interface Fonte {
  id: string;
  nome: string;
  url: string;
  licenca: string;
  licencaUrl: string;
  /** Texto de atribuição que deve acompanhar o dado redistribuído. */
  atribuicao: string;
}

export interface Campo {
  nome: string;
  tipo: TipoCampo;
  descricao: string;
  unidade?: string;
  /** Pode ser usado em `filtros` e `ordenar`. Padrão: true (geometria: sempre false). */
  filtravel?: boolean;
  /** Vem na resposta quando `campos` não é informado. Padrão: true (geometria: false). */
  padrao?: boolean;
}

export interface ExemploConsulta {
  descricao: string;
  consulta: Record<string, unknown>;
}

export interface Conjunto {
  /** Id completo `dominio.conjunto`, ex.: `territorio.municipios`. */
  id: string;
  dominio: string;
  titulo: string;
  descricao: string;
  /** Tabela no DuckDB. */
  tabela: string;
  fonte: Fonte;
  campos: Campo[];
  /** Campo usado por `inicio`/`fim`. Ausente = conjunto sem dimensão de tempo. */
  campoTempo?: string;
  frequencia?: "anual" | "mensal" | "diaria" | "horaria" | "estatico";
  chave: string[];
  ordenacaoPadrao: string[];
  /**
   * Vazio é legítimo (ex.: séries só das estações escolhidas — uma lista só de
   * pluviômetros não tem cota). O portão `nao_vazia` vira alerta em vez de bloquear.
   */
  podeFicarVazio?: boolean;
  /** Termos usados pela busca (`/search`). */
  tags: string[];
  /** Cuidados de interpretação que vão junto em toda resposta. */
  avisos?: string[];
  exemplos: ExemploConsulta[];
}

export interface Dominio {
  id: string;
  titulo: string;
  setor: Setor;
  descricao: string;
  conjuntos: Conjunto[];
}
