const USER_AGENT = "brasil-dados-utilities/0.1 (+https://balance.ia.br)";

/**
 * Só baixamos de domínios oficiais, sempre por HTTPS. Os portais do governo
 * terminam em .gov.br; o ONS (associação civil, .org.br) tem portal próprio e
 * publica os arquivos num bucket S3 dele.
 * Vale também para o destino final de redirecionamentos.
 */
const HOSTS_EXATOS = new Set(["dados.ons.org.br", "ons-aws-prod-opendata.s3.amazonaws.com"]);
const SUFIXOS = [".gov.br"];

export function hostPermitido(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  return HOSTS_EXATOS.has(h) || SUFIXOS.some((s) => h.endsWith(s));
}

function exigirHostPermitido(url: string, contexto = "origem"): void {
  if (!hostPermitido(url)) {
    throw new Error(`Download recusado (${contexto} fora da lista de fontes oficiais ou sem HTTPS): ${url}`);
  }
}

/** Registro do que foi baixado na coleta em curso (vai para a proveniência). */
export interface RegistroDownload {
  url: string;
  requisicoes: number;
  bytes: number;
  sha256?: string;
  arquivo?: string;
  do_cache?: boolean;
}
const registro = new Map<string, RegistroDownload>();

export function iniciarRegistro(): void {
  registro.clear();
}
export function lerRegistro(): RegistroDownload[] {
  return [...registro.values()].sort((a, b) => a.url.localeCompare(b.url));
}
/** Requisições de API (paginadas) são agregadas por endereço, sem a query string. */
function anotarRequisicao(url: string, bytes: number): void {
  const u = new URL(url);
  const chave = `${u.origin}${u.pathname}`;
  const r = registro.get(chave) ?? { url: chave, requisicoes: 0, bytes: 0 };
  r.requisicoes++;
  r.bytes += bytes;
  registro.set(chave, r);
}
export function anotarArquivo(r: Omit<RegistroDownload, "requisicoes">): void {
  registro.set(r.url, { ...r, requisicoes: 1 });
}

/** GET com tempo limite, novas tentativas e checagem de host (inclusive após redirecionamento). */
export interface OpcoesBaixar {
  tentativas?: number;
  tempoLimiteMs?: number;
  /** Cabeçalhos extras (ex.: Authorization). Nunca entram em log, erro ou proveniência. */
  cabecalhos?: Record<string, string>;
}

export async function baixar(
  url: string,
  { tentativas = 3, tempoLimiteMs = 60_000, cabecalhos }: OpcoesBaixar = {},
): Promise<Response> {
  exigirHostPermitido(url);
  let ultimoErro: unknown;
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(url, {
        headers: { ...cabecalhos, "user-agent": USER_AGENT },
        // com credencial, não segue redirecionamento (o cabeçalho iria junto para o destino)
        redirect: cabecalhos ? "error" : "follow",
        signal: AbortSignal.timeout(tempoLimiteMs),
      });
      exigirHostPermitido(r.url || url, "redirecionamento");
      if (r.ok) return r;
      ultimoErro = new Error(`HTTP ${r.status} em ${url}`);
      if (r.status < 500 && r.status !== 429) break; // erro do cliente: não adianta repetir
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Download recusado")) throw e;
      ultimoErro = e;
    }
    await new Promise((ok) => setTimeout(ok, 1000 * 2 ** i));
  }
  throw ultimoErro;
}

/** Limite para respostas de API lidas em memória. */
const MAX_JSON_BYTES = 200 * 1024 * 1024;

export async function baixarTexto(url: string, opcoes?: OpcoesBaixar): Promise<string> {
  const r = await baixar(url, opcoes);
  const declarado = Number(r.headers.get("content-length") ?? 0);
  if (declarado > MAX_JSON_BYTES) throw new Error(`Resposta grande demais (${declarado} bytes): ${url}`);
  const texto = await r.text();
  const bytes = Buffer.byteLength(texto);
  if (bytes > MAX_JSON_BYTES) throw new Error(`Resposta grande demais (${bytes} bytes): ${url}`);
  anotarRequisicao(url, bytes);
  return texto;
}

export async function baixarJson<T>(url: string, opcoes?: OpcoesBaixar): Promise<T> {
  const texto = await baixarTexto(url, opcoes);
  try {
    return JSON.parse(texto) as T;
  } catch {
    throw new Error(`A fonte não devolveu JSON válido: ${url}`);
  }
}
