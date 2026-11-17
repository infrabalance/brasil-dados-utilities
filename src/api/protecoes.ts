import type { MiddlewareHandler } from "hono";

/**
 * Proteções do servidor HTTP. Os dados são públicos e só de leitura, mas o
 * servidor precisa aguentar abuso e não pode ser usado contra quem o roda.
 */
export interface OpcoesProtecao {
  /** Requisições por minuto por cliente (0 = sem limite). */
  limitePorMinuto: number;
  /** Origens de navegador aceitas no /mcp (além de nenhuma Origin, caso de clientes MCP fora do navegador). */
  origensMcp: string[];
  /** Hosts aceitos no cabeçalho Host (vazio = qualquer). Protege contra DNS rebinding quando o servidor é local. */
  hostsPermitidos: string[];
  /** Ler o IP do cliente de X-Forwarded-For (só atrás de proxy confiável). */
  confiarProxy: boolean;
}

const lista = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

export function opcoesDoAmbiente(env = process.env): OpcoesProtecao {
  const host = env.HOST ?? "127.0.0.1";
  const porta = env.PORT ?? "3010";
  const local = LOOPBACK.has(host);
  return {
    limitePorMinuto: Number(env.BDU_LIMITE_POR_MINUTO ?? 120),
    origensMcp: env.BDU_ORIGENS_MCP ? lista(env.BDU_ORIGENS_MCP)
      : [`http://localhost:${porta}`, `http://127.0.0.1:${porta}`],
    // ligado só em localhost por padrão; em produção, informe o domínio público
    hostsPermitidos: env.BDU_HOSTS ? lista(env.BDU_HOSTS)
      : local ? [`localhost:${porta}`, `127.0.0.1:${porta}`, `[::1]:${porta}`, "localhost", "127.0.0.1"] : [],
    confiarProxy: env.BDU_CONFIAR_PROXY === "1",
  };
}

const negar = (codigo: string, mensagem: string) => ({ erro: { codigo, mensagem } });

export function exigirHost(hosts: string[]): MiddlewareHandler {
  const aceitos = new Set(hosts.map((h) => h.toLowerCase()));
  return async (c, next) => {
    if (aceitos.size === 0) return next();
    const host = (c.req.header("host") ?? new URL(c.req.url).host).toLowerCase();
    if (!host || !aceitos.has(host)) return c.json(negar("host_recusado", "Host não permitido."), 421);
    return next();
  };
}

/** Exigência da especificação MCP: validar Origin para evitar DNS rebinding. */
export function exigirOrigem(origens: string[]): MiddlewareHandler {
  const aceitas = new Set(origens);
  return async (c, next) => {
    const origem = c.req.header("origin");
    if (origem && !aceitas.has(origem)) return c.json(negar("origem_recusada", "Origin não permitida no /mcp."), 403);
    return next();
  };
}

/** Janela fixa de 1 minuto por cliente. Suficiente para um servidor único; atrás de CDN, limite lá também. */
export function limitarTaxa(porMinuto: number, chaveDoCliente: (c: Parameters<MiddlewareHandler>[0]) => string): MiddlewareHandler {
  const contagem = new Map<string, { janela: number; n: number }>();
  return async (c, next) => {
    if (porMinuto <= 0) return next();
    const janela = Math.floor(Date.now() / 60_000);
    const chave = chaveDoCliente(c);
    const atual = contagem.get(chave);
    const reg = atual && atual.janela === janela ? atual : { janela, n: 0 };
    reg.n++;
    contagem.set(chave, reg);
    if (contagem.size > 50_000) for (const [k, v] of contagem) if (v.janela !== janela) contagem.delete(k);
    c.header("ratelimit-limit", String(porMinuto));
    c.header("ratelimit-remaining", String(Math.max(0, porMinuto - reg.n)));
    if (reg.n > porMinuto) {
      c.header("retry-after", String(60 - (Math.floor(Date.now() / 1000) % 60)));
      return c.json(negar("limite_excedido", `Mais de ${porMinuto} requisições por minuto. Aguarde e tente de novo.`), 429);
    }
    return next();
  };
}
