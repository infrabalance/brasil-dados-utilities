import { registrarProveniencia, type Linha } from "../banco/db.ts";
import { substituirTabela } from "../banco/carga.ts";
import { IBGE } from "../dominios/fontes.ts";
import { baixarArquivo, lit } from "./arquivos.ts";
import { baixarJson } from "./http.ts";
import type { Coletor } from "./tipos.ts";

const URL_MUNICIPIOS = "https://servicodados.ibge.gov.br/api/v1/localidades/municipios";
// SIDRA tabela 4709, variável 93 = população residente, Censo 2022, nível município
const URL_POPULACAO = "https://apisidra.ibge.gov.br/values/t/4709/n6/all/v/93/p/2022";
// malha municipal vigente, qualidade intermediária (~12 MB), WGS84
const URL_MALHA =
  "https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo%2Bjson&qualidade=intermediaria&intrarregiao=municipio";

interface UF { id: number; sigla: string; nome: string; regiao: { sigla: string; nome: string } }
interface MunicipioIbge {
  id: number;
  nome: string;
  microrregiao: { mesorregiao: { UF: UF } } | null;
  "regiao-imediata": { nome: string; "regiao-intermediaria": { nome: string; UF: UF } } | null;
}
type LinhaSidra = Record<string, string>;

export const coletorIbge: Coletor = {
  dominio: "territorio",
  conjuntos: ["territorio.municipios", "territorio.ufs", "territorio.malha_municipios"],

  async coletar(banco, log) {
    log("IBGE: baixando municípios…");
    const municipios = await baixarJson<MunicipioIbge[]>(URL_MUNICIPIOS);
    log(`IBGE: ${municipios.length} municípios. Baixando população do Censo 2022 (SIDRA 4709)…`);
    const sidra = await baixarJson<LinhaSidra[]>(URL_POPULACAO);

    // a 1ª linha do SIDRA é o cabeçalho
    const populacao = new Map<string, number>();
    for (const l of sidra.slice(1)) {
      const v = Number(l.V);
      if (l.D1C && Number.isFinite(v)) populacao.set(l.D1C, v);
    }

    const linhas: Linha[] = [];
    const semUf: string[] = [];
    for (const m of municipios) {
      const imediata = m["regiao-imediata"];
      const uf = imediata?.["regiao-intermediaria"].UF ?? m.microrregiao?.mesorregiao.UF;
      if (!uf) {
        semUf.push(m.nome);
        continue;
      }
      const codigo = String(m.id);
      linhas.push({
        codigo_ibge: codigo,
        nome: m.nome,
        uf: uf.sigla,
        uf_nome: uf.nome,
        codigo_uf: String(uf.id),
        regiao: uf.regiao.sigla,
        regiao_nome: uf.regiao.nome,
        regiao_imediata: imediata?.nome ?? null,
        regiao_intermediaria: imediata?.["regiao-intermediaria"].nome ?? null,
        populacao_2022: populacao.get(codigo) ?? null,
      });
    }
    if (semUf.length) throw new Error(`IBGE: municípios sem UF na resposta: ${semUf.join(", ")}`);

    const semPop = linhas.filter((l) => l.populacao_2022 === null).length;
    await substituirTabela(
      banco,
      "territorio_municipios",
      {
        codigo_ibge: "VARCHAR", nome: "VARCHAR", uf: "VARCHAR", uf_nome: "VARCHAR", codigo_uf: "VARCHAR",
        regiao: "VARCHAR", regiao_nome: "VARCHAR", regiao_imediata: "VARCHAR",
        regiao_intermediaria: "VARCHAR", populacao_2022: "BIGINT",
      },
      linhas,
    );
    await registrarProveniencia(banco, {
      conjunto: "territorio.municipios",
      fonte: IBGE.nome,
      url_origem: `${URL_MUNICIPIOS} ; ${URL_POPULACAO}`,
      licenca: IBGE.licenca,
      data_referencia: "Censo 2022 (população); divisão territorial vigente na coleta",
      linhas: linhas.length,
      observacao: semPop ? `${semPop} município(s) sem população no SIDRA` : null,
    });
    log(`IBGE: territorio.municipios gravado (${linhas.length} linhas${semPop ? `, ${semPop} sem população` : ""}).`);

    await banco.exec(`
      create or replace table territorio_ufs as
      select codigo_uf, uf, uf_nome, regiao, regiao_nome,
             count(*)::bigint as municipios,
             sum(populacao_2022)::bigint as populacao_2022
      from territorio_municipios
      group by all`);
    const [{ n }] = (await banco.consultar<{ n: number }>("select count(*)::int as n from territorio_ufs")) as [
      { n: number },
    ];
    await registrarProveniencia(banco, {
      conjunto: "territorio.ufs",
      fonte: IBGE.nome,
      url_origem: `${URL_MUNICIPIOS} ; ${URL_POPULACAO}`,
      licenca: IBGE.licenca,
      data_referencia: "Censo 2022 (população)",
      linhas: n,
      observacao: "Agregado dos municípios coletados",
    });
    log(`IBGE: territorio.ufs gravado (${n} linhas).`);

    // malha municipal: GeoJSON para a API + WKB interno para cruzamentos espaciais
    await banco.exec("install spatial; load spatial;");
    const arq = await baixarArquivo(URL_MALHA, "ibge", "malha-municipios-intermediaria.geojson", log, {
      validadeMs: 30 * 24 * 3600_000,
    });
    await banco.exec(`
      create or replace table _geo_municipios as
      select cast(codarea as varchar) as codigo_ibge, st_aswkb(geom) as wkb
      from st_read(${lit(arq)})`);
    await banco.exec(`
      create or replace table territorio_malha as
      select g.codigo_ibge, m.nome, m.uf, st_asgeojson(st_geomfromwkb(g.wkb)) as geometria
      from _geo_municipios g left join territorio_municipios m using (codigo_ibge)`);
    const [mg] = await banco.consultar<{ n: number; sem: number }>(
      `select count(*)::bigint n, count(*) filter (where nome is null)::bigint sem from territorio_malha`,
    );
    const semMalha = await banco.consultar<{ nome: string; uf: string }>(
      `select nome, uf from territorio_municipios where codigo_ibge not in (select codigo_ibge from _geo_municipios)`,
    );
    await registrarProveniencia(banco, {
      conjunto: "territorio.malha_municipios",
      fonte: IBGE.nome,
      url_origem: URL_MALHA,
      licenca: IBGE.licenca,
      data_referencia: "Malha municipal vigente na API de malhas do IBGE (qualidade intermediária)",
      linhas: Number(mg?.n ?? 0),
      observacao:
        (semMalha.length ? `Sem polígono na malha: ${semMalha.map((x) => `${x.nome}/${x.uf}`).join(", ")}. ` : "") +
        (mg?.sem ? `${mg.sem} polígono(s) sem município correspondente.` : ""),
    });
    log(`IBGE: territorio.malha_municipios gravado (${mg?.n} polígonos${semMalha.length ? `; sem polígono: ${semMalha.map((x) => x.nome).join(", ")}` : ""}).`);
  },
};
