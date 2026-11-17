import { unzipSync } from "fflate";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registrarProveniencia, type Banco, type Linha } from "../banco/db.ts";
import { substituirTabela } from "../banco/carga.ts";
import { SINISA } from "../dominios/fontes.ts";
import { baixarArquivo, lit } from "./arquivos.ts";
import { baixarTexto } from "./http.ts";
import type { Coletor } from "./tipos.ts";

const BASE = "https://www.gov.br/cidades/pt-br/acesso-a-informacao/acoes-e-programas/saneamento/sinisa";
/** Páginas onde o Ministério publica os pacotes de planilhas (um ano de referência por pacote). */
const PAGINAS = [`${BASE}/resultados-sinisa`, `${BASE}/resultados-sinisa/resultados-sinisa-2025`];

type Modulo = "agua" | "esgoto";
interface Pacote { url: string; ano: number }

/** Acha nas páginas os zips com as planilhas por município. */
async function acharPacotes(): Promise<Pacote[]> {
  const achados = new Map<string, Pacote>();
  for (const pagina of PAGINAS) {
    const html = await baixarTexto(pagina);
    for (const m of html.matchAll(/href="([^"]+\/(SINISA_(?:Resultados_Ref|ESGOTO_Planilhas_)(\d{4})\.zip))"/g)) {
      achados.set(m[2]!, { url: m[1]!, ano: Number(m[3]) });
    }
  }
  if (achados.size === 0) throw new Error("SINISA: nenhum pacote de planilhas encontrado nas páginas de resultados (o site mudou?)");
  return [...achados.values()];
}

/** Teto por arquivo descompactado: as planilhas reais têm poucos MB (proteção contra zip bomb). */
const MAX_DESCOMPACTADO = 300 * 1024 * 1024;

function descompactar(zip: Uint8Array, aceitar: (nome: string) => boolean): Record<string, Uint8Array> {
  return unzipSync(zip, {
    filter: (f) => {
      if (!aceitar(f.name)) return false;
      if (f.originalSize > MAX_DESCOMPACTADO) {
        throw new Error(`SINISA: ${f.name} descompacta para ${f.originalSize} bytes (acima do teto); arquivo recusado.`);
      }
      return true;
    },
  });
}

const limpar = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** Planilhas "Indicadores … Base Municipal" dentro do zip, com o módulo. */
function planilhasDeIndicadores(zip: Uint8Array): { nome: string; modulo: Modulo; dados: Uint8Array }[] {
  const arquivos = descompactar(zip, (n) => /Indicadores_Base Municipal.*\.xlsx$/i.test(n));
  return Object.entries(arquivos).map(([nome, dados]) => ({
    nome,
    modulo: /ESGOTO/i.test(nome) ? "esgoto" : "agua",
    dados,
  }));
}

/** Nomes das abas, lidos do workbook.xml dentro do xlsx. */
function abas(xlsx: Uint8Array): string[] {
  const wb = descompactar(xlsx, (n) => n === "xl/workbook.xml")["xl/workbook.xml"];
  if (!wb) return [];
  const xml = new TextDecoder().decode(wb);
  return [...xml.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) =>
    m[1]!.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">"),
  );
}

const ATRIBUTOS: Record<string, string> = {
  cod_IBGE: "codigo_ibge",
  "Macrorregião": "macrorregiao",
  "Município": "municipio",
  UF: "uf",
  Capital: "capital",
  "RM/RIDE": "rm_ride",
  CAD0002: "natureza_juridica",
  CAD0003: "abrangencia",
  CAD0005: "prestador",
  CAD0006: "prestador_sigla",
};
const EH_INDICADOR = /^I[A-Z]{2}\d{4}$/;

interface Indicador { modulo: Modulo; codigo: string; nome: string; grupo: string; unidade: string }

/**
 * Lê uma aba no formato do SINISA: linhas de título, depois grupo / nome /
 * unidade / código, e os municípios. Localiza tudo pela linha que começa com
 * `cod_IBGE`, então funciona nos layouts de 2023 (uma aba por grupo) e 2024.
 */
async function lerAba(
  banco: Banco, arquivo: string, aba: string, modulo: Modulo, ano: number,
  linhas: Linha[], indicadores: Map<string, Indicador>,
): Promise<number> {
  const r = await banco.consultar<Record<string, string | null>>(
    `select * from read_xlsx(${lit(arquivo)}, sheet = ${lit(aba)}, header = false, all_varchar = true, range = 'A1:GZ20000')`,
  );
  const grade = r.map((l) => Object.values(l));
  const iCod = grade.findIndex((l) => l[0] === "cod_IBGE");
  if (iCod < 3) return 0; // aba sem dados (ex.: nota metodológica)
  const codigos = grade[iCod]!, unidades = grade[iCod - 1]!, nomes = grade[iCod - 2]!, grupos = grade[iCod - 3]!;

  let grupo = aba;
  const colsIndicador: { i: number; codigo: string }[] = [];
  const colsAtributo: { i: number; campo: string }[] = [];
  codigos.forEach((c, i) => {
    if (grupos[i]) grupo = limpar(grupos[i]);
    if (!c) return;
    if (EH_INDICADOR.test(c)) {
      colsIndicador.push({ i, codigo: c });
      const chave = `${modulo}:${c}`;
      if (!indicadores.has(chave)) {
        indicadores.set(chave, {
          modulo, codigo: c, nome: limpar(nomes[i]),
          // em 2023 o grupo é a própria aba; em 2024 vem numa linha acima
          grupo: grupos.some(Boolean) ? grupo : aba,
          unidade: limpar(unidades[i]),
        });
      }
    } else if (ATRIBUTOS[c]) {
      colsAtributo.push({ i, campo: ATRIBUTOS[c] });
    }
  });

  let n = 0;
  for (const l of grade.slice(iCod + 1)) {
    if (!l[0] || !/^\d{7}$/.test(l[0])) continue;
    const base: Linha = { ano, modulo };
    for (const { i, campo } of colsAtributo) base[campo] = limpar(l[i]) || null;
    for (const { i, codigo } of colsIndicador) {
      const bruto = limpar(l[i]);
      if (!bruto) continue;
      const num = Number(bruto);
      linhas.push({
        ...base,
        indicador: codigo,
        valor: Number.isFinite(num) ? num : null,
        situacao: Number.isFinite(num) ? null : bruto,
      });
    }
    n++;
  }
  return n;
}

export const coletorSinisa: Coletor = {
  dominio: "saneamento",
  conjuntos: ["saneamento.indicadores", "saneamento.dicionario"],

  async coletar(banco, log) {
    await banco.exec("install excel; load excel;");
    const pacotes = await acharPacotes();
    log(`SINISA: ${pacotes.length} pacote(s): ${pacotes.map((p) => p.url.split("/").pop()).join(", ")}`);

    const linhas: Linha[] = [];
    const indicadores = new Map<string, Indicador>();
    const resumo: string[] = [];
    const tmp = mkdtempSync(join(tmpdir(), "bdu-sinisa-"));
    try {
      for (const p of pacotes) {
        const zip = await baixarArquivo(p.url, "sinisa", p.url.split("/").pop()!, log, {
          validadeMs: 7 * 24 * 3600_000, // publicação anual, com retificações eventuais
        });
        for (const pl of planilhasDeIndicadores(readFileSync(zip))) {
          const arq = join(tmp, `${p.ano}-${pl.modulo}.xlsx`);
          writeFileSync(arq, pl.dados);
          let municipios = 0;
          for (const aba of abas(pl.dados)) {
            if (/nota/i.test(aba)) continue;
            municipios = Math.max(municipios, await lerAba(banco, arq, aba, pl.modulo, p.ano, linhas, indicadores));
          }
          resumo.push(`${pl.modulo} ${p.ano}: ${municipios} municípios (${pl.nome.split("/").pop()})`);
          log(`SINISA: ${pl.modulo} ${p.ano} — ${municipios} municípios`);
        }
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    if (linhas.length === 0) throw new Error("SINISA: nenhuma linha lida (layout mudou?)");

    // a planilha às vezes repete o mesmo município; tira repetições idênticas e conta as divergentes
    const vistos = new Map<string, Linha>();
    let repetidas = 0, divergentes = 0;
    const unicas = linhas.filter((l) => {
      const k = `${l.ano}|${l.modulo}|${l.codigo_ibge}|${l.indicador}`;
      const antes = vistos.get(k);
      if (!antes) return vistos.set(k, l), true;
      if (antes.valor === l.valor && antes.situacao === l.situacao) repetidas++;
      else divergentes++;
      return false;
    });
    linhas.length = 0;
    for (const l of unicas) linhas.push(l); // sem spread: são centenas de milhares de itens

    // nome, grupo e unidade vêm do dicionário; a tabela de valores guarda só o código
    const dic = [...indicadores.values()];
    const porChave = new Map(dic.map((d) => [`${d.modulo}:${d.codigo}`, d]));
    for (const l of linhas) {
      const d = porChave.get(`${l.modulo}:${l.indicador}`)!;
      l.indicador_nome = d.nome;
      l.unidade = d.unidade;
      l.grupo = d.grupo;
    }

    await substituirTabela(banco, "saneamento_indicadores", {
      ano: "INTEGER", modulo: "VARCHAR", codigo_ibge: "VARCHAR", municipio: "VARCHAR", uf: "VARCHAR",
      macrorregiao: "VARCHAR", capital: "VARCHAR", rm_ride: "VARCHAR", natureza_juridica: "VARCHAR",
      abrangencia: "VARCHAR", prestador: "VARCHAR", prestador_sigla: "VARCHAR", indicador: "VARCHAR",
      indicador_nome: "VARCHAR", grupo: "VARCHAR", unidade: "VARCHAR", valor: "DOUBLE", situacao: "VARCHAR",
    }, linhas);

    const anosPorIndicador = await banco.consultar<{ modulo: string; indicador: string; anos: string }>(
      `select modulo, indicador, string_agg(distinct ano::varchar, ', ' order by ano::varchar) anos
       from saneamento_indicadores group by all`,
    );
    const anos = new Map(anosPorIndicador.map((a) => [`${a.modulo}:${a.indicador}`, a.anos]));
    await substituirTabela(banco, "saneamento_dicionario", {
      modulo: "VARCHAR", indicador: "VARCHAR", nome: "VARCHAR", grupo: "VARCHAR", unidade: "VARCHAR", anos: "VARCHAR",
    }, dic.map((d) => ({
      modulo: d.modulo, indicador: d.codigo, nome: d.nome, grupo: d.grupo, unidade: d.unidade,
      anos: anos.get(`${d.modulo}:${d.codigo}`) ?? null,
    })));

    const naoCalc = linhas.filter((l) => l.situacao).length;
    const faixaAnos = [...new Set(pacotes.map((p) => p.ano))].sort().join(", ");
    await registrarProveniencia(banco, {
      conjunto: "saneamento.indicadores",
      fonte: SINISA.nome,
      url_origem: PAGINAS.join(" ; "),
      licenca: SINISA.licenca,
      data_referencia: `Anos de referência ${faixaAnos} (anual)`,
      linhas: linhas.length,
      observacao:
        `${resumo.join("; ")}. ${naoCalc} valores publicados como "Não calculado" (motivo em situacao).` +
        (repetidas ? ` ${repetidas} valores repetidos na planilha original removidos.` : "") +
        (divergentes ? ` ${divergentes} valores divergentes para o mesmo município e indicador (mantido o primeiro).` : ""),
    });
    await registrarProveniencia(banco, {
      conjunto: "saneamento.dicionario",
      fonte: SINISA.nome,
      url_origem: PAGINAS.join(" ; "),
      licenca: SINISA.licenca,
      data_referencia: `Anos de referência ${faixaAnos}`,
      linhas: dic.length,
      observacao: "Nome, grupo e unidade como nos cabeçalhos das planilhas oficiais.",
    });
    log(`SINISA: saneamento.indicadores gravado (${linhas.length} linhas, ${dic.length} indicadores; ${naoCalc} não calculados).`);
  },
};
