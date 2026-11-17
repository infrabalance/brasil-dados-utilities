import { registrarProveniencia, type Banco } from "../banco/db.ts";
import { ANEEL } from "../dominios/fontes.ts";
import { baixarArquivo, lit, pacoteCkan, recurso } from "./arquivos.ts";
import type { Coletor } from "./tipos.ts";

const CKAN = "https://dadosabertos.aneel.gov.br";
const PACOTE = "siga-sistema-de-informacoes-de-geracao-da-aneel";

/** Siglas do SIGA → nome por extenso. */
export const TIPOS_USINA: Record<string, string> = {
  UHE: "Usina hidrelétrica",
  PCH: "Pequena central hidrelétrica",
  CGH: "Central geradora hidrelétrica",
  UTE: "Usina termelétrica",
  UTN: "Usina termonuclear",
  EOL: "Central geradora eólica",
  UFV: "Central geradora solar fotovoltaica",
  CGU: "Central geradora undi-elétrica",
};

/** Caixa que contém o território brasileiro, ilhas oceânicas incluídas (Trindade ~ −29,3°). */
const DENTRO_DO_BRASIL = "lat between -34.0 and 5.5 and lon between -74.5 and -28.5";

const num = (col: string) => `try_cast(replace(nullif(trim(${col}), ''), ',', '.') as double)`;

export const coletorUsinas: Coletor = {
  dominio: "energia",
  id: "usinas",
  conjuntos: ["energia.usinas"],

  async coletar(banco: Banco, log) {
    const p = await pacoteCkan(CKAN, PACOTE);
    const r = recurso(p, "CSV", "siga-empreendimentos-geracao.csv");
    const arq = await baixarArquivo(r.url, "aneel", "siga-empreendimentos-geracao.csv", log);

    await banco.exec(`
      create or replace temp table _siga as
      select * from read_csv(${lit(arq)}, delim = ';', header = true, all_varchar = true, quote = '"', encoding = 'utf-8')`);
    const [b] = await banco.consultar<{ n: number }>("select count(*)::bigint n from _siga");

    await banco.exec(`
      create or replace temp table _usinas as
      select
        trim(CodCEG) as codigo_ceg,
        trim(NomEmpreendimento) as nome,
        trim(SigUFPrincipal) as uf,
        trim(SigTipoGeracao) as tipo,
        trim(DscFaseUsina) as fase,
        trim(DscOrigemCombustivel) as origem,
        trim(DscFonteCombustivel) as fonte,
        trim(DscTipoOutorga) as outorga,
        try_cast(DatEntradaOperacao as date) as entrada_operacao,
        ${num("MdaPotenciaOutorgadaKw")} / 1000 as potencia_outorgada_mw,
        ${num("MdaPotenciaFiscalizadaKw")} / 1000 as potencia_fiscalizada_mw,
        ${num("MdaGarantiaFisicaKw")} / 1000 as garantia_fisica_mw,
        trim(IdcGeracaoQualificada) = 'Sim' as geracao_qualificada,
        ${num("NumCoordNEmpreendimento")} as lat,
        ${num("NumCoordEEmpreendimento")} as lon,
        nullif(trim(DscPropriRegimePariticipacao), '') as proprietarios,
        nullif(trim(DscSubBacia), '') as sub_bacia,
        nullif(trim(DscMuninicpios), '') as municipios,
        try_cast(DatGeracaoConjuntoDados as date) as data_arquivo,
        try_cast(DatInicioVigencia as date) as inicio_vigencia
      from _siga`);
    // o arquivo traz algumas linhas repetidas: fica uma por código CEG (a vigência mais recente)
    await banco.exec(`
      create or replace temp table _usinas_u as
      select * exclude (rn) from (
        select *, row_number() over (partition by codigo_ceg order by inicio_vigencia desc nulls last, nome) rn from _usinas
      ) where rn = 1`);
    const [c] = await banco.consultar<{ dup: number; invalidas: number; data_arq: string }>(`
      select (select count(*) from _usinas) - (select count(*) from _usinas_u) dup,
             (select count(*) from _usinas_u where lat is null or lon is null or (lat = 0 and lon = 0) or not (${DENTRO_DO_BRASIL})) invalidas,
             (select max(data_arquivo)::varchar from _usinas_u) as data_arq`);

    const temMalha = await banco.tabelaExiste("_geo_municipios");
    if (temMalha) await banco.exec("load spatial");
    const tipoNome = Object.entries(TIPOS_USINA).map(([k, v]) => `when '${k}' then '${v}'`).join(" ");
    await banco.exec(`
      create or replace table energia_usinas as
      with u as (
        select * exclude (lat, lon),
          case when lat is not null and lon is not null and not (lat = 0 and lon = 0) and ${DENTRO_DO_BRASIL} then lat end as latitude,
          case when lat is not null and lon is not null and not (lat = 0 and lon = 0) and ${DENTRO_DO_BRASIL} then lon end as longitude
        from _usinas_u
      )
      select u.codigo_ceg, u.nome, u.tipo, case u.tipo ${tipoNome} else u.tipo end as tipo_nome, u.fase, u.origem, u.fonte, u.outorga,
             u.uf, u.municipios, ${temMalha ? "g.codigo_ibge" : "null::varchar"} as codigo_ibge_coordenada,
             u.potencia_outorgada_mw, u.potencia_fiscalizada_mw, u.garantia_fisica_mw, u.geracao_qualificada,
             u.entrada_operacao, u.latitude, u.longitude, u.sub_bacia, u.proprietarios
      from u
      ${temMalha ? `left join (select codigo_ibge, st_geomfromwkb(wkb) geom from _geo_municipios) g
        on u.latitude is not null and st_intersects(g.geom, st_point(u.longitude, u.latitude))` : ""}
      qualify row_number() over (partition by u.codigo_ceg order by ${temMalha ? "g.codigo_ibge" : "1"}) = 1`);
    await banco.exec("drop table _siga; drop table _usinas; drop table _usinas_u;");

    const [t] = await banco.consultar<{ n: number; uhe: number; mw: number }>(
      "select count(*)::bigint n, count(*) filter (where tipo = 'UHE')::bigint uhe, round(sum(potencia_fiscalizada_mw) filter (where fase = 'Operação'))::bigint mw from energia_usinas",
    );
    await registrarProveniencia(banco, {
      conjunto: "energia.usinas",
      fonte: ANEEL.nome,
      url_origem: `${CKAN}/dataset/${PACOTE} ; ${r.url}`,
      licenca: ANEEL.licenca,
      data_referencia: `Cadastro do SIGA de ${c?.data_arq ?? "data não informada"}`,
      linhas: Number(t?.n ?? 0),
      observacao:
        `${b?.n} linhas no arquivo; ${c?.dup ?? 0} repetidas por código CEG removidas (fica a vigência mais recente). ` +
        `${c?.invalidas ?? 0} usinas com coordenada zerada ou fora do território: latitude/longitude = null (o restante do cadastro vale). ` +
        `Potências convertidas de kW para MW. codigo_ibge_coordenada = município cujo polígono contém o ponto (calculado).`,
    });
    log(`ANEEL usinas: energia.usinas gravado (${t?.n} usinas, ${t?.uhe} UHE, ${t?.mw} MW fiscalizados em operação; ${c?.invalidas} sem coordenada válida).`);
  },
};
