import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Banco, Linha } from "./db.ts";

/**
 * Substitui a tabela inteira pelas linhas dadas, com os tipos declarados.
 * Grava NDJSON temporário e deixa o DuckDB ler (rápido e sem montar INSERT à mão).
 */
export async function substituirTabela(
  banco: Banco,
  tabela: string,
  colunas: Record<string, string>,
  linhas: Linha[],
): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/.test(tabela)) throw new Error(`nome de tabela inválido: ${tabela}`);
  const dir = mkdtempSync(join(tmpdir(), "bdu-"));
  const arquivo = join(dir, "carga.ndjson");
  try {
    writeFileSync(arquivo, linhas.map((l) => JSON.stringify(l)).join("\n"));
    const cols = Object.entries(colunas)
      .map(([nome, tipo]) => `'${nome}': '${tipo}'`)
      .join(", ");
    await banco.exec(
      `create or replace table ${tabela} as
       select * from read_json('${arquivo.replaceAll("'", "''")}', format = 'newline_delimited', columns = {${cols}})`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
