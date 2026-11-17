import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { anotarArquivo, baixar, baixarJson } from "./http.ts";

/** Pasta dos arquivos brutos baixados (cache entre coletas). */
export const PASTA_BRUTOS =
  process.env.BDU_RAW ?? fileURLToPath(new URL("../../data/raw", import.meta.url));

/** Reaproveita o arquivo baixado se for mais novo que isso. */
const VALIDADE_CACHE_MS = Number(process.env.BDU_CACHE_HORAS ?? 20) * 3600_000;

/** Teto por arquivo baixado (o maior arquivo real hoje tem ~100 MB). */
const MAX_ARQUIVO_BYTES = Number(process.env.BDU_MAX_ARQUIVO_MB ?? 2048) * 1024 * 1024;

async function sha256DoArquivo(caminho: string): Promise<string> {
  const h = createHash("sha256");
  await pipeline(createReadStream(caminho), h);
  return h.digest("hex");
}

/**
 * Baixa `url` para `data/raw/<fonte>/<nome>`, com cache.
 * Grava em arquivo temporário e renomeia no fim (nunca deixa arquivo pela metade),
 * calcula o SHA-256 no caminho e anota URL, tamanho e hash para a proveniência.
 */
export async function baixarArquivo(
  url: string,
  fonte: string,
  nome: string,
  log?: (m: string) => void,
  { validadeMs = VALIDADE_CACHE_MS }: { validadeMs?: number } = {},
): Promise<string> {
  if (!/^[\w.\- ]+$/.test(nome) || nome.startsWith(".")) throw new Error(`nome de arquivo inválido: ${nome}`);
  const destino = join(PASTA_BRUTOS, fonte, nome);
  if (existsSync(destino) && Date.now() - statSync(destino).mtimeMs < validadeMs) {
    anotarArquivo({ url, arquivo: `${fonte}/${nome}`, bytes: statSync(destino).size, sha256: await sha256DoArquivo(destino), do_cache: true });
    return destino;
  }
  mkdirSync(dirname(destino), { recursive: true });
  log?.(`  baixando ${nome}…`);
  const r = await baixar(url, { tempoLimiteMs: 15 * 60_000 });
  if (!r.body) throw new Error(`resposta vazia: ${url}`);
  const declarado = Number(r.headers.get("content-length") ?? 0);
  if (declarado > MAX_ARQUIVO_BYTES) throw new Error(`${nome}: ${declarado} bytes, acima do teto de download`);

  const tmp = `${destino}.parcial`;
  const hash = createHash("sha256");
  let bytes = 0;
  const medir = new Transform({
    transform(pedaco: Buffer, _enc, ok) {
      bytes += pedaco.length;
      if (bytes > MAX_ARQUIVO_BYTES) return ok(new Error(`${nome}: passou do teto de download`));
      hash.update(pedaco);
      ok(null, pedaco);
    },
  });
  try {
    await pipeline(Readable.fromWeb(r.body as never), medir, createWriteStream(tmp));
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  if (bytes === 0) {
    rmSync(tmp, { force: true });
    throw new Error(`${nome}: a fonte devolveu arquivo vazio`);
  }
  renameSync(tmp, destino);
  anotarArquivo({ url, arquivo: `${fonte}/${nome}`, bytes, sha256: hash.digest("hex"), do_cache: false });
  return destino;
}

export interface RecursoCkan {
  id: string;
  name: string;
  format: string;
  url: string;
  last_modified: string | null;
  created: string;
}

export interface PacoteCkan {
  name: string;
  title: string;
  metadata_modified: string;
  license_id: string;
  resources: RecursoCkan[];
}

/** Metadados de um conjunto num portal CKAN (ANEEL e ONS usam CKAN). */
export async function pacoteCkan(base: string, id: string): Promise<PacoteCkan> {
  const r = await baixarJson<{ success: boolean; result: PacoteCkan }>(
    `${base}/api/3/action/package_show?id=${encodeURIComponent(id)}`,
  );
  if (!r.success) throw new Error(`CKAN ${base}: pacote ${id} não encontrado`);
  return r.result;
}

/** Acha um recurso por formato e trecho do nome; erro claro se a fonte mudou. */
export function recurso(p: PacoteCkan, formato: string, nomeContem: string): RecursoCkan {
  const r = p.resources.find(
    (x) => x.format.toUpperCase() === formato.toUpperCase() && x.name.toLowerCase().includes(nomeContem.toLowerCase()),
  );
  if (!r) {
    throw new Error(
      `${p.name}: recurso ${formato} com "${nomeContem}" não encontrado. ` +
        `A fonte pode ter mudado. Recursos: ${p.resources.map((x) => `${x.format}:${x.name}`).join(", ")}`,
    );
  }
  return r;
}

/** Escapa um caminho de arquivo para uso literal no SQL do DuckDB. */
export const lit = (s: string) => `'${s.replaceAll("'", "''")}'`;
