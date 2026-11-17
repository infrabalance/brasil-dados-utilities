import { agua } from "./agua.ts";
import { energia } from "./energia.ts";
import { saneamento } from "./saneamento.ts";
import { territorio } from "./territorio.ts";
import type { Conjunto, Dominio } from "./tipos.ts";

export const DOMINIOS: Dominio[] = [territorio, energia, saneamento, agua];

export const CONJUNTOS: Map<string, Conjunto> = new Map(
  DOMINIOS.flatMap((d) => d.conjuntos).map((c) => [c.id, c]),
);

export function acharConjunto(id: string): Conjunto | undefined {
  return CONJUNTOS.get(id);
}

export function acharDominio(id: string): Dominio | undefined {
  return DOMINIOS.find((d) => d.id === id);
}

const semAcento = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

const PALAVRAS_VAZIAS = new Set(["a", "o", "as", "os", "de", "da", "do", "das", "dos", "e", "em", "no", "na", "nos", "nas", "por", "para", "com", "um", "uma", "qual", "quais", "como"]);

/** Busca simples por termo no título, descrição, tags e campos. */
export function buscar(termo: string): { conjunto: Conjunto; pontos: number }[] {
  const palavras = semAcento(termo).split(/\s+/).filter((p) => p && !PALAVRAS_VAZIAS.has(p));
  if (palavras.length === 0) return [];
  const resultados: { conjunto: Conjunto; pontos: number }[] = [];
  for (const c of CONJUNTOS.values()) {
    const tags = c.tags.map(semAcento);
    const texto = semAcento(
      [c.id, c.titulo, c.descricao, ...c.campos.map((f) => `${f.nome} ${f.descricao}`)].join(" "),
    );
    let pontos = 0;
    for (const p of palavras) {
      if (tags.some((t) => t === p)) pontos += 3;
      else if (tags.some((t) => t.includes(p))) pontos += 2;
      if (texto.includes(p)) pontos += 1;
    }
    if (pontos > 0) resultados.push({ conjunto: c, pontos });
  }
  return resultados.sort((a, b) => b.pontos - a.pontos);
}
