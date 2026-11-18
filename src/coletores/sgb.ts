import { registrarProveniencia, type Linha } from "../banco/db.ts";
import { substituirTabela } from "../banco/carga.ts";
import { SGB } from "../dominios/fontes.ts";
import { baixarJson } from "./http.ts";
import type { Coletor } from "./tipos.ts";

/** Setorização de risco geológico (SGB/CPRM), camada pública do geoportal. */
const CAMADA = "https://geoportal.sgb.gov.br/server/rest/services/gestaoterritorial/risco/FeatureServer/0";

interface FeicaoGeo {
  properties: Record<string, string | number | null>;
  geometry: { type: string; coordinates: unknown } | null;
}

const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
// a camada passou a mandar a data como texto "AAAA-MM-DD" (nov/2026); antes era epoch em ms
const data = (v: unknown) =>
  typeof v === "number" ? new Date(v).toISOString().slice(0, 10)
  : typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
/** "TRAMANDAÍ (RS)" → "TRAMANDAÍ" (o nome novo vem com a UF entre parênteses). */
const semUf = (v: string | null) => (v ? v.replace(/\s*\([A-Z]{2}\)\s*$/, "").trim() || null : null);
/** Teto de setores sem município: acima disso a coleta é recusada e a base anterior fica no ar. */
const MAX_SEM_MUNICIPIO = 0.02;

export const coletorSgb: Coletor = {
  dominio: "territorio",
  conjuntos: ["territorio.risco_setores"],

  async coletar(banco, log) {
    const feicoes: FeicaoGeo[] = [];
    let ultimo = -1;
    for (;;) {
      const url =
        `${CAMADA}/query?where=${encodeURIComponent(`objectid > ${ultimo}`)}` +
        `&outFields=*&orderByFields=objectid&resultRecordCount=2000&outSR=4326&geometryPrecision=6&f=geojson`;
      const r = await baixarJson<{ features?: FeicaoGeo[]; error?: { message: string } }>(url);
      if (r.error) throw new Error(`SGB: ${r.error.message}`);
      const lote = r.features ?? [];
      if (lote.length === 0) break;
      feicoes.push(...lote);
      ultimo = Number(lote.at(-1)!.properties.objectid);
      log(`SGB: ${feicoes.length} setores…`);
    }
    if (feicoes.length === 0) throw new Error("SGB: nenhum setor retornado");

    const linhas: Linha[] = feicoes.map(({ properties: p, geometry }) => {
      const tipologias: string[] = [];
      const cobrades: string[] = [];
      for (let i = 1; i <= 5; i++) {
        const g = txt(p[`tipolo_g${i}`]);
        const e = txt(p[`tipolo_e${i}`]);
        if (g) tipologias.push(e ? `${g} (${e})` : g);
        const c = txt(p[`cobrade_0${i}`]);
        if (c) cobrades.push(c);
      }
      return {
        id_sgb: String(p.objectid),
        setor: txt(p.num_setor),
        uf: txt(p.uf),
        // até out/2026 vinham cd_geocmu (código IBGE) e munic; em nov/2026 a camada tirou o código e trocou
        // munic por municipio ("NOME (UF)"). O código é recuperado depois, pelo nome ou pela coordenada.
        codigo_ibge: txt(p.cd_geocmu),
        municipio: semUf(txt(p.munic) ?? txt(p.municipio)),
        data_setorizacao: data(p.data_setor),
        local: txt(p.local),
        tipologia: txt(p.tipolo_g1),
        tipologia_especifica: txt(p.tipolo_e1),
        tipologias: tipologias.join("; ") || null,
        cobrade: cobrades.join("; ") || null,
        grau_risco: txt(p.grau_risco),
        grau_vulnerabilidade: txt(p.grau_vulne),
        edificacoes: num(p.num_edif),
        domicilios: num(p.num_domi),
        pessoas: num(p.num_pess),
        descricao: txt(p.descricao),
        ocupacao: txt(p.obs_ocup),
        intervencoes_sugeridas: txt(p.sug_interv),
        orgao_executor: txt(p.orgao_exec),
        geometria: geometry ? JSON.stringify(geometry) : null,
      };
    });

    await substituirTabela(banco, "_sgb_setores", {
      id_sgb: "VARCHAR", setor: "VARCHAR", uf: "VARCHAR", codigo_ibge: "VARCHAR", municipio: "VARCHAR", data_setorizacao: "DATE",
      local: "VARCHAR", tipologia: "VARCHAR", tipologia_especifica: "VARCHAR", tipologias: "VARCHAR",
      cobrade: "VARCHAR", grau_risco: "VARCHAR", grau_vulnerabilidade: "VARCHAR", edificacoes: "BIGINT",
      domicilios: "BIGINT", pessoas: "BIGINT", descricao: "VARCHAR", ocupacao: "VARCHAR",
      intervencoes_sugeridas: "VARCHAR", orgao_executor: "VARCHAR", geometria: "VARCHAR",
    }, linhas);

    // centróide (ponto de referência) e WKB interno para cruzamentos espaciais
    await banco.exec("install spatial; load spatial;");
    await banco.exec(`
      create or replace table _geo_risco as
      select id_sgb, setor, st_aswkb(st_geomfromgeojson(geometria)) as wkb
      from _sgb_setores where geometria is not null`);
    await banco.exec(`
      create or replace table territorio_risco_setores as
      with c as (
        select id_sgb, st_centroid(st_geomfromwkb(wkb)) as pt from _geo_risco)
      select s.* exclude (geometria), round(st_y(c.pt), 6) as latitude, round(st_x(c.pt), 6) as longitude, s.geometria
      from _sgb_setores s left join c using (id_sgb)`);
    await banco.exec("drop table _sgb_setores");

    // município do setor: código da fonte; sem ele, pelo nome + UF na lista do IBGE; sem casar o nome,
    // pelo polígono do município que contém o centróide. O nome passa a ser o oficial do IBGE.
    const norm = (col: string) => `regexp_replace(strip_accents(upper(${col})), '[^A-Z0-9]', '', 'g')`;
    if (await banco.tabelaExiste("territorio_municipios")) {
      await banco.exec(`
        create or replace temp table _sgb_ibge as
        with mun as (select codigo_ibge, uf, ${norm("nome")} chave from territorio_municipios)
        select s.id_sgb, coalesce(s.codigo_ibge, m.codigo_ibge) as ibge_nome
        from territorio_risco_setores s left join mun m on m.uf = s.uf and m.chave = ${norm("s.municipio")}`);
      if (await banco.tabelaExiste("_geo_municipios")) {
        await banco.exec(`
          create or replace temp table _sgb_geo as
          with g as (select codigo_ibge, st_geomfromwkb(wkb) geom from _geo_municipios)
          select s.id_sgb, min(g.codigo_ibge) as ibge_geo
          from territorio_risco_setores s join _sgb_ibge i using (id_sgb)
          join g on st_intersects(g.geom, st_point(s.longitude, s.latitude))
          where i.ibge_nome is null and s.latitude is not null and s.longitude is not null
          group by s.id_sgb`);
      } else {
        await banco.exec("create or replace temp table _sgb_geo as select null::varchar id_sgb, null::varchar ibge_geo where false");
      }
      await banco.exec(`
        create or replace table territorio_risco_setores as
        select s.* replace (coalesce(i.ibge_nome, g.ibge_geo) as codigo_ibge, coalesce(m.nome, s.municipio) as municipio)
        from territorio_risco_setores s
        join _sgb_ibge i using (id_sgb)
        left join _sgb_geo g using (id_sgb)
        left join territorio_municipios m on m.codigo_ibge = coalesce(i.ibge_nome, g.ibge_geo)`);
      await banco.exec("drop table _sgb_ibge; drop table _sgb_geo;");
    }

    const [r] = await banco.consultar<{ n: number; dup: number; dup_id: number; sem_geo: number; fora: number; sem_ibge: number }>(`
      select count(*)::bigint n, (count(*) - count(distinct setor))::bigint dup,
             (count(*) - count(distinct id_sgb))::bigint dup_id,
             count(*) filter (where geometria is null)::bigint sem_geo,
             count(*) filter (where codigo_ibge not in (select codigo_ibge from territorio_municipios))::bigint fora,
             count(*) filter (where codigo_ibge is null)::bigint sem_ibge
      from territorio_risco_setores`);
    if (r?.dup_id) throw new Error(`SGB: ${r.dup_id} objectid repetidos — paginação ou junção errada`);
    if (Number(r?.n) !== feicoes.length) throw new Error(`SGB: ${feicoes.length} lidos, ${r?.n} gravados`);
    // nov/2026: a fonte mudou o formato e TODOS os setores entraram sem município sem ninguém perceber
    // (o "fora" acima não conta nulo). Agora sem município acima do teto = coleta recusada.
    if (Number(r?.sem_ibge) > Number(r?.n) * MAX_SEM_MUNICIPIO) {
      throw new Error(`SGB: ${r?.sem_ibge} de ${r?.n} setores sem município (teto ${MAX_SEM_MUNICIPIO * 100}%) — a fonte mudou de formato? Mantida a versão anterior.`);
    }
    await registrarProveniencia(banco, {
      conjunto: "territorio.risco_setores",
      fonte: SGB.nome,
      url_origem: CAMADA,
      licenca: SGB.licenca,
      data_referencia: "Setorizações acumuladas até a coleta (data de cada setor em data_setorizacao)",
      linhas: Number(r?.n ?? 0),
      observacao:
        "latitude/longitude = centróide calculado do polígono (referência, não é ponto oficial)." +
        (r?.dup ? ` ${r.dup} códigos de setor repetidos na fonte.` : "") +
        (r?.sem_geo ? ` ${r.sem_geo} setores sem polígono.` : "") +
        (r?.fora ? ` ${r.fora} setores com código IBGE fora da divisão atual.` : "") +
        (r?.sem_ibge ? ` ${r.sem_ibge} setores sem município identificado.` : ""),
    });
    log(`SGB: territorio.risco_setores gravado (${r?.n} setores${r?.dup ? `, ${r.dup} códigos repetidos` : ""}${r?.sem_ibge ? `, ${r.sem_ibge} sem município` : ""}).`);
  },
};
