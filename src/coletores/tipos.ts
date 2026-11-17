import type { Banco } from "../banco/db.ts";

export interface Coletor {
  /** Domínio que este coletor alimenta (`npm run coletar -- <dominio>`). */
  dominio: string;
  /** Nome para rodar só este coletor (`npm run coletar -- <id>`). Padrão: o domínio. */
  id?: string;
  conjuntos: string[];
  /**
   * Coletor opcional (ex.: exige credencial). Devolve o motivo para pular, ou null se pode rodar.
   * Em `coletar todos` / `coletar <dominio>` ele é pulado sem erro; chamado pelo id, o motivo vira erro.
   */
  indisponivel?(): string | null;
  coletar(banco: Banco, log: (msg: string) => void): Promise<void>;
}
