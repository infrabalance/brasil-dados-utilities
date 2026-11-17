import { registrarProveniencia, type Linha } from "../banco/db.ts";
import { substituirTabela } from "../banco/carga.ts";
import { ANA } from "../dominios/fontes.ts";
import { baixarJson } from "./http.ts";
import type { Coletor } from "./tipos.ts";

/** Camada pública do SNIRH com o inventário da Rede Hidrometeorológica Nacional. */
const CAMADA =
  "https://portal1.snirh.gov.br/server/rest/services/Esta%C3%A7%C3%B5es_Hidrometeorol%C3%B3gicas_SNIRH/FeatureServer/0";
const PAGINA_DADO =
  "https://dadosabertos.ana.gov.br/datasets/cbdda4679ff941c9878efa8200491627";

interface Feicao { attributes: Record<string, string | number | null> }

const simNao = (v: unknown) => (v === "Sim" ? true : v === "Não" ? false : null);
const data = (v: unknown) => (typeof v === "number" ? new Date(v).toISOString().slice(0, 10) : null);

export const coletorAna: Coletor = {
  dominio: "agua",
  conjuntos: ["agua.estacoes"],

  async coletar(banco, log) {
    // pagina pela chave (Codigo), 1000 por vez — limite do serviço
    const feicoes: Feicao[] = [];
    let ultimo = -1;
    for (;;) {
      const url =
        `${CAMADA}/query?where=${encodeURIComponent(`Codigo > ${ultimo}`)}` +
        `&outFields=*&orderByFields=Codigo&resultRecordCount=1000&returnGeometry=false&f=json`;
      const r = await baixarJson<{ features?: Feicao[]; error?: { message: string } }>(url);
      if (r.error) throw new Error(`SNIRH: ${r.error.message}`);
      const lote = r.features ?? [];
      if (lote.length === 0) break;
      feicoes.push(...lote);
      ultimo = Number(lote.at(-1)!.attributes.Codigo);
      if (feicoes.length % 10000 < 1000) log(`ANA: ${feicoes.length} estações…`);
    }
    if (feicoes.length === 0) throw new Error("SNIRH: nenhuma estação retornada");

    const linhas: Linha[] = feicoes.map(({ attributes: a }) => ({
      codigo: String(a.Codigo),
      nome: a.Nome,
      tipo: a.TipoEstacao,
      operando: simNao(a.Operando),
      codigo_adicional: a.CodigoAdicional || null,
      latitude: a.Latitude,
      longitude: a.Longitude,
      altitude_m: a.Altitude,
      area_drenagem_km2: a.AreaDrenagem,
      bacia: a.Bacia || null,
      sub_bacia: a.SubBacia || null,
      rio: a.Rio || null,
      uf_nome: a.UF || null,
      municipio: a.Municipio || null,
      municipio_codigo_hidro: a.MunicipioCodigo ? String(a.MunicipioCodigo) : null,
      responsavel: a.ResponsavelSigla || null,
      operadora: a.OperadoraSigla || null,
      escala_nivel: simNao(a.EscalaNivel),
      registrador_nivel: simNao(a.RegistradorNivel),
      descarga_liquida: simNao(a.MedicaoDescargaLiquida),
      qualidade_agua: simNao(a.MedicaoQA),
      pluviometro: simNao(a.PluviometroConvencional),
      registrador_chuva: simNao(a.RegistradorChuva),
      telemetrica: simNao(a.EstacaoTelemetrica),
      telemetrica_inicio: data(a.EstacaoTelemetricaInicio),
      atualizado_em: data(a.DataAlteracao),
    }));

    await substituirTabela(banco, "_ana_estacoes", {
      codigo: "VARCHAR", nome: "VARCHAR", tipo: "VARCHAR", operando: "BOOLEAN", codigo_adicional: "VARCHAR",
      latitude: "DOUBLE", longitude: "DOUBLE", altitude_m: "DOUBLE", area_drenagem_km2: "DOUBLE",
      bacia: "VARCHAR", sub_bacia: "VARCHAR", rio: "VARCHAR", uf_nome: "VARCHAR", municipio: "VARCHAR",
      municipio_codigo_hidro: "VARCHAR", responsavel: "VARCHAR", operadora: "VARCHAR",
      escala_nivel: "BOOLEAN", registrador_nivel: "BOOLEAN", descarga_liquida: "BOOLEAN", qualidade_agua: "BOOLEAN",
      pluviometro: "BOOLEAN", registrador_chuva: "BOOLEAN", telemetrica: "BOOLEAN", telemetrica_inicio: "DATE",
      atualizado_em: "DATE",
    }, linhas);

    // A base HIDRO tem códigos de município próprios. Associa ao IBGE:
    // codigo_ibge = município registrado pela ANA (UF + nome); sem correspondência de nome, usa a coordenada.
    // codigo_ibge_coordenada = município cujo polígono contém o ponto (calculado; diverge perto das divisas).
    const norm = (col: string) =>
      `regexp_replace(strip_accents(upper(${col})), '[^A-Z0-9]', '', 'g')`;
    const temTerritorio = await banco.tabelaExiste("territorio_municipios");
    const temMalha = await banco.tabelaExiste("_geo_municipios");
    if (!temTerritorio) {
      await banco.exec(`create or replace table agua_estacoes as
        select * exclude (uf_nome), null::varchar uf, uf_nome, null::varchar codigo_ibge,
               null::varchar codigo_ibge_metodo, null::varchar codigo_ibge_coordenada
        from _ana_estacoes`);
    } else {
      await banco.exec(`
        create or replace temp table _ana_nome as
        with ufs as (select distinct uf, uf_nome from territorio_municipios),
             mun as (select codigo_ibge, uf, ${norm("nome")} chave from territorio_municipios)
        select e.*, u.uf, m.codigo_ibge as ibge_nome
        from _ana_estacoes e
        left join ufs u on ${norm("u.uf_nome")} = ${norm("e.uf_nome")}
        left join mun m on m.uf = u.uf and m.chave = ${norm("e.municipio")}`);
      if (temMalha) {
        await banco.exec("install spatial; load spatial;");
        await banco.exec(`
          create or replace temp table _ana_geo as
          with g as (select codigo_ibge, st_geomfromwkb(wkb) geom from _geo_municipios)
          select e.codigo, min(g.codigo_ibge) as ibge_geo
          from _ana_nome e join g on st_intersects(g.geom, st_point(e.longitude, e.latitude))
          where e.uf is not null and e.latitude is not null and e.longitude is not null
          group by e.codigo`);
      } else {
        await banco.exec("create or replace temp table _ana_geo as select null::varchar codigo, null::varchar ibge_geo where false");
      }
      await banco.exec(`
        create or replace table agua_estacoes as
        select n.* exclude (uf_nome, uf, ibge_nome), n.uf, n.uf_nome,
               coalesce(n.ibge_nome, g.ibge_geo) as codigo_ibge,
               case when n.ibge_nome is not null then 'nome' when g.ibge_geo is not null then 'coordenada' end as codigo_ibge_metodo,
               g.ibge_geo as codigo_ibge_coordenada,
               (g.ibge_geo is not null and n.ibge_nome is not null and g.ibge_geo <> n.ibge_nome) as _diverge
        from _ana_nome n left join _ana_geo g using (codigo)`);
      await banco.exec("drop table _ana_nome; drop table _ana_geo;");
    }
    await banco.exec("drop table _ana_estacoes");

    const [c] = await banco.consultar<{
      n: number; sem_ibge: number; exterior: number; dup: number; geo: number; nome: number; diverge: number;
    }>(
      `select count(*)::bigint n,
              count(*) filter (where codigo_ibge is null and uf is not null)::bigint sem_ibge,
              count(*) filter (where uf is null)::bigint exterior,
              (count(*) - count(distinct codigo))::bigint dup,
              count(*) filter (where codigo_ibge_metodo = 'coordenada')::bigint geo,
              count(*) filter (where codigo_ibge_metodo = 'nome')::bigint nome,
              ${temTerritorio ? "count(*) filter (where _diverge)::bigint" : "0"} diverge
       from agua_estacoes`,
    );
    if (temTerritorio) await banco.exec("alter table agua_estacoes drop column _diverge");
    if (c?.dup) throw new Error(`ANA: ${c.dup} estações duplicadas após associar município`);
    await registrarProveniencia(banco, {
      conjunto: "agua.estacoes",
      fonte: ANA.nome,
      url_origem: `${PAGINA_DADO} ; ${CAMADA}`,
      licenca: ANA.licenca,
      data_referencia: "Inventário vigente na coleta",
      linhas: Number(c?.n ?? 0),
      observacao:
        `codigo_ibge associado (a base HIDRO usa códigos próprios): ${c?.nome ?? 0} pelo município registrado (UF + nome), ` +
        `${c?.geo ?? 0} pela coordenada (nome sem correspondência). ` +
        `${c?.diverge ?? 0} estações em que o ponto cai em outro município (perto de divisas; ver codigo_ibge_coordenada). ` +
        `${c?.exterior ?? 0} estações fora do Brasil (uf = null). ${c?.sem_ibge ?? 0} brasileiras sem associação.`,
    });
    log(`ANA: agua.estacoes gravado (${c?.n} estações; IBGE por nome ${c?.nome}, por coordenada ${c?.geo}, ponto em outro município ${c?.diverge}, sem ${c?.sem_ibge}, exterior ${c?.exterior}).`);
  },
};
