import { DuckDBInstance, DuckDBTypeId, type DuckDBConnection, type DuckDBValue } from "@duckdb/node-api";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export type Linha = Record<string, unknown>;

/**
 * Caminho do banco local: `BDU_DB` ou `data/bdu.duckdb` na raiz do projeto
 * (independe da pasta de onde o MCP é chamado). `:memory:` serve para testes.
 */
export function caminhoBanco(): string {
  return process.env.BDU_DB ?? fileURLToPath(new URL("../../data/bdu.duckdb", import.meta.url));
}

/**
 * Converte valores do DuckDB para JSON amigável: BIGINT vira number,
 * DATE vira AAAA-MM-DD, TIMESTAMP vira ISO, NaN vira null.
 */
function normalizarValor(v: unknown, ehData: boolean): unknown {
  if (typeof v === "bigint") {
    return v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(v) : v.toString();
  }
  if (v instanceof Date) return ehData ? v.toISOString().slice(0, 10) : v.toISOString();
  if (typeof v === "number" && Number.isNaN(v)) return null;
  return v;
}

/** Erro de consulta que passou do tempo limite (o DuckDB foi interrompido). */
export class TempoEsgotado extends Error {}

/** Fila simples: no máximo N consultas ao mesmo tempo (protege memória e CPU). */
class Semaforo {
  private livres: number;
  private fila: (() => void)[] = [];
  constructor(n: number) { this.livres = n; }
  async com<T>(fn: () => Promise<T>): Promise<T> {
    if (this.livres > 0) this.livres--;
    else await new Promise<void>((ok) => this.fila.push(ok));
    try { return await fn(); } finally {
      const prox = this.fila.shift();
      if (prox) prox(); else this.livres++;
    }
  }
}

const TEMPO_CONSULTA_MS = Number(process.env.BDU_TEMPO_CONSULTA_MS ?? 15_000);
const CONSULTAS_SIMULTANEAS = Number(process.env.BDU_CONSULTAS_SIMULTANEAS ?? 4);

export class Banco {
  private readonly semaforo = new Semaforo(CONSULTAS_SIMULTANEAS);

  private constructor(
    private conn: DuckDBConnection,
    private inst?: DuckDBInstance,
    /** Modo servidor: só leitura, uma conexão por consulta, configuração travada. */
    readonly blindado = false,
  ) {}

  /**
   * API e MCP abrem só leitura (vários processos podem ler ao mesmo tempo);
   * o coletor abre para escrita — o DuckDB não deixa ler e escrever o mesmo
   * arquivo em processos diferentes.
   */
  static async abrir(
    caminho = caminhoBanco(),
    { somenteLeitura = false }: { somenteLeitura?: boolean } = {},
  ): Promise<Banco> {
    const emMemoria = caminho === ":memory:";
    if (!emMemoria) mkdirSync(dirname(caminho), { recursive: true });
    if (somenteLeitura && !emMemoria && !existsSync(caminho)) {
      // banco ainda não existe: cria vazio com as tabelas de controle
      const novo = await DuckDBInstance.create(caminho);
      const c = await novo.connect();
      await new Banco(c).migrar();
      c.closeSync();
      novo.closeSync();
    }
    const opcoes: Record<string, string> = somenteLeitura && !emMemoria ? { access_mode: "READ_ONLY" } : {};
    if (process.env.BDU_MEMORIA) opcoes.memory_limit = process.env.BDU_MEMORIA;
    const inst = await DuckDBInstance.create(caminho, opcoes);
    if (!somenteLeitura) {
      const banco = new Banco(await inst.connect(), inst);
      await banco.migrar();
      return banco;
    }
    const conn = await inst.connect();
    await blindar(conn);
    return new Banco(conn, inst, true);
  }

  /**
   * Modo servidor: reabre o arquivo (o coletor trocou a base por uma nova) sem
   * derrubar o serviço. Consultas novas vão para a base nova; a antiga é fechada
   * depois de `folgaMs`, quando as consultas em andamento já terminaram.
   */
  async recarregar(caminho = caminhoBanco(), folgaMs = 120_000): Promise<void> {
    if (!this.blindado) throw new Error("recarregar só vale no modo servidor (só leitura)");
    const novo = await Banco.abrir(caminho, { somenteLeitura: true });
    const velho = { conn: this.conn, inst: this.inst };
    this.conn = novo.conn;
    this.inst = novo.inst;
    setTimeout(() => {
      try { velho.conn.closeSync(); velho.inst?.closeSync(); } catch { /* já fechada */ }
    }, folgaMs).unref();
  }

  fechar(): void {
    this.conn.closeSync();
    this.inst?.closeSync();
  }

  async exec(sql: string, params?: DuckDBValue[]): Promise<void> {
    await this.conn.run(sql, params);
  }

  /**
   * No modo servidor cada consulta usa conexão própria (requisições em paralelo
   * não se misturam), entra na fila do semáforo e é interrompida se passar do tempo.
   */
  async consultar<T extends Linha = Linha>(
    sql: string,
    params?: DuckDBValue[],
    { tempoLimiteMs = TEMPO_CONSULTA_MS }: { tempoLimiteMs?: number } = {},
  ): Promise<T[]> {
    if (!this.blindado || !this.inst) return this.ler<T>(this.conn, sql, params);
    const inst = this.inst;
    return this.semaforo.com(async () => {
      const conn = await inst.connect();
      let estourou = false;
      const relogio = setTimeout(() => { estourou = true; conn.interrupt(); }, tempoLimiteMs);
      try {
        return await this.ler<T>(conn, sql, params);
      } catch (e) {
        if (estourou) throw new TempoEsgotado(`Consulta passou de ${tempoLimiteMs / 1000} s.`);
        throw e;
      } finally {
        clearTimeout(relogio);
        conn.closeSync();
      }
    });
  }

  private async ler<T extends Linha>(conn: DuckDBConnection, sql: string, params?: DuckDBValue[]): Promise<T[]> {
    const r = await conn.runAndReadAll(sql, params);
    const nomes = r.columnNames();
    const ehData = nomes.map((_, i) => r.columnTypeId(i) === DuckDBTypeId.DATE);
    return r.getRowsJS().map((linha) => {
      const saida: Linha = {};
      linha.forEach((v, i) => (saida[nomes[i]!] = normalizarValor(v, ehData[i]!)));
      return saida;
    }) as T[];
  }

  private espacialCarregado = false;

  /** Carrega a extensão spatial (instalada na coleta) para consultas por ponto. */
  async carregarEspacial(): Promise<void> {
    if (this.espacialCarregado || this.blindado) return; // no modo servidor já vem carregada
    try {
      await this.exec("load spatial");
    } catch {
      await this.exec("install spatial; load spatial;");
    }
    this.espacialCarregado = true;
  }

  async tabelaExiste(nome: string): Promise<boolean> {
    const r = await this.consultar(
      "select 1 from information_schema.tables where table_name = ?",
      [nome],
    );
    return r.length > 0;
  }

  /** Tabelas de controle comuns a todos os coletores. */
  private async migrar(): Promise<void> {
    await this.exec(`
      create table if not exists _proveniencia (
        conjunto        varchar primary key,   -- ex.: territorio.municipios
        fonte           varchar not null,      -- ex.: IBGE
        url_origem      varchar not null,
        licenca         varchar not null,
        data_referencia varchar,               -- ano/mês/data a que o dado se refere
        coletado_em     timestamp not null,
        linhas          bigint not null,
        observacao      varchar
      )`);
    // integridade: arquivos de origem (URL, tamanho, SHA-256) e verificações de qualidade da coleta
    await this.exec("alter table _proveniencia add column if not exists arquivos varchar");
    await this.exec("alter table _proveniencia add column if not exists verificacoes varchar");
  }
}

/**
 * Modo servidor: carrega a spatial antes, depois fecha o acesso a arquivos e à
 * rede (nenhuma consulta lê fora do banco, mesmo que algo escape da validação)
 * e trava a configuração para que nenhum SET a desfaça.
 */
async function blindar(conn: DuckDBConnection): Promise<void> {
  try {
    await conn.run("load spatial");
  } catch {
    // sem a extensão instalada: consultas espaciais respondem erro, o resto funciona
  }
  await conn.run("set autoinstall_known_extensions = false");
  await conn.run("set autoload_known_extensions = false");
  await conn.run("set enable_external_access = false");
  await conn.run("set allow_community_extensions = false");
  await conn.run("set lock_configuration = true");
}

export interface Proveniencia {
  conjunto: string;
  fonte: string;
  url_origem: string;
  licenca: string;
  data_referencia: string | null;
  coletado_em: string;
  linhas: number;
  observacao: string | null;
  arquivos?: unknown;
  verificacoes?: unknown;
}

export async function registrarProveniencia(
  banco: Banco,
  p: Omit<Proveniencia, "coletado_em" | "arquivos" | "verificacoes">,
): Promise<void> {
  await banco.exec(
    `insert or replace into _proveniencia
       (conjunto, fonte, url_origem, licenca, data_referencia, coletado_em, linhas, observacao)
     values (?, ?, ?, ?, ?, current_timestamp, ?, ?)`,
    [p.conjunto, p.fonte, p.url_origem, p.licenca, p.data_referencia, p.linhas, p.observacao],
  );
}

/** Colunas JSON da proveniência voltam como objeto. */
export function abrirProveniencia<T extends Linha>(p: T): T {
  for (const k of ["arquivos", "verificacoes"]) {
    if (typeof p[k] === "string") {
      try { (p as Linha)[k] = JSON.parse(p[k] as string); } catch { /* mantém texto */ }
    }
  }
  return p;
}

export async function lerProveniencias(banco: Banco): Promise<Proveniencia[]> {
  const ps = await banco.consultar<Proveniencia & Linha>("select * from _proveniencia order by conjunto");
  return ps.map(abrirProveniencia);
}
