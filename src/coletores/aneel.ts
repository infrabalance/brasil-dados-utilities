import { registrarProveniencia, type Banco } from "../banco/db.ts";
import { ANEEL } from "../dominios/fontes.ts";
import { INDICADORES_CONTINUIDADE } from "../dominios/energia.ts";
import { baixarArquivo, lit, pacoteCkan, recurso, type PacoteCkan } from "./arquivos.ts";
import type { Coletor } from "./tipos.ts";

const CKAN = "https://dadosabertos.aneel.gov.br";
const PAGINA = (p: PacoteCkan) => `${CKAN}/dataset/${p.name}`;

/** CNPJ vem como número no arquivo: recompõe os 14 dígitos (zeros à esquerda). */
const cnpj = (col: string) => `lpad(cast(${col} as varchar), 14, '0')`;

async function contar(banco: Banco, sql: string): Promise<number> {
  const [r] = await banco.consultar<{ n: number }>(`select count(*)::bigint as n from (${sql})`);
  return Number(r?.n ?? 0);
}

export const coletorAneel: Coletor = {
  id: "aneel",
  dominio: "energia",
  conjuntos: [
    "energia.continuidade",
    "energia.continuidade_limites",
    "energia.conjuntos_municipios",
    "energia.balanco",
  ],

  async coletar(banco, log) {
    await continuidade(banco, log);
    await limites(banco, log);
    await conjuntosMunicipios(banco, log);
    await balanco(banco, log);
  },
};

async function continuidade(banco: Banco, log: (m: string) => void) {
  const p = await pacoteCkan(CKAN, "indicadores-coletivos-de-continuidade-dec-e-fec");
  const arquivos = p.resources.filter((r) =>
    /^indicadores-continuidade-coletivos-\d{4}-\d{4}\.parquet$/i.test(r.name),
  );
  if (arquivos.length === 0) throw new Error("ANEEL: nenhum parquet de DEC/FEC encontrado (a fonte mudou?)");
  log(`ANEEL DEC/FEC: ${arquivos.length} arquivos parquet`);
  const locais: string[] = [];
  for (const r of arquivos) locais.push(await baixarArquivo(r.url, "aneel", r.name, log));

  const bruto = `select * from read_parquet([${locais.map(lit).join(", ")}])`;
  const linhasBrutas = await contar(banco, bruto);

  // linhas sem conjunto só trazem NumConsAgt (consumidores por distribuidora, 2000–2012): ficam de fora
  const semConjunto = await contar(banco, `${bruto} where IdeConjUndConsumidoras is null`);
  // o arquivo publicado repete cada linha; tiramos as repetições exatas
  await banco.exec(`
    create or replace temp table _cont as
    select distinct
      trim(SigAgente) as distribuidora, ${cnpj("NumCNPJ")} as cnpj,
      cast(IdeConjUndConsumidoras as varchar) as conjunto_id, trim(DscConjUndConsumidoras) as conjunto,
      trim(SigIndicador) as ind, cast(AnoIndice as integer) as ano, cast(NumPeriodoIndice as integer) as mes,
      VlrIndiceEnviado as v
    from (${bruto}) where IdeConjUndConsumidoras is not null`);
  const distintas = await contar(banco, "select * from _cont");
  const conflitos = await contar(
    banco,
    "select 1 from _cont group by distribuidora, conjunto_id, ind, ano, mes having count(distinct v) > 1",
  );

  const colunas = INDICADORES_CONTINUIDADE.map(
    (i) => `max(v) filter (where ind = '${i.codigo}') as ${i.codigo.toLowerCase()}`,
  ).join(",\n      ");
  await banco.exec(`
    create or replace table energia_continuidade as
    select distribuidora, any_value(cnpj) as cnpj, conjunto_id, any_value(conjunto) as conjunto,
      ano, mes, printf('%04d-%02d', ano, mes) as periodo,
      cast(max(v) filter (where ind = 'NumCon') as bigint) as consumidores,
      ${colunas}
    from _cont
    group by distribuidora, conjunto_id, ano, mes`);
  await banco.exec("drop table _cont");
  const n = await contar(banco, "select * from energia_continuidade");
  const [faixa] = await banco.consultar<{ a: string; b: string }>(
    "select min(periodo) a, max(periodo) b from energia_continuidade",
  );

  await registrarProveniencia(banco, {
    conjunto: "energia.continuidade",
    fonte: ANEEL.nome,
    url_origem: PAGINA(p),
    licenca: ANEEL.licenca,
    data_referencia: `${faixa?.a} a ${faixa?.b} (mensal)`,
    linhas: n,
    observacao:
      `Fonte atualizada em ${p.metadata_modified.slice(0, 10)}. ${linhasBrutas - semConjunto - distintas} linhas repetidas no arquivo original removidas; ` +
      `${semConjunto} linhas sem conjunto (indicador NumConsAgt, consumidores por distribuidora) não entram neste conjunto` +
      (conflitos ? `; ${conflitos} chaves com valores divergentes (mantido o maior)` : "") + ".",
  });
  log(`ANEEL: energia.continuidade gravado (${n} linhas, ${faixa?.a}–${faixa?.b}; ${linhasBrutas - distintas} repetidas removidas${conflitos ? `, ${conflitos} conflitos` : ""}).`);
}

async function limites(banco: Banco, log: (m: string) => void) {
  const p = await pacoteCkan(CKAN, "indicadores-coletivos-de-continuidade-dec-e-fec");
  const r = recurso(p, "CSV", "limite");
  const arq = await baixarArquivo(r.url, "aneel", "indicadores-continuidade-coletivos-limite.csv", log);
  const ler = `read_csv(${lit(arq)}, delim = ';', header = true, decimal_separator = ',',
      types = {'NumCNPJ': 'VARCHAR', 'IdeConjUndConsumidoras': 'VARCHAR', 'VlrLimite': 'DOUBLE'})`;
  const linhasBrutas = await contar(banco, `select * from ${ler}`);
  await banco.exec(`
    create or replace table energia_continuidade_limites as
    with d as (
      select distinct trim(SigAgente) as distribuidora, ${cnpj("NumCNPJ")} as cnpj,
        IdeConjUndConsumidoras as conjunto_id, trim(DscConjUndConsumidoras) as conjunto,
        trim(SigIndicador) as ind, cast(AnoLimiteQualidade as integer) as ano, VlrLimite as v
      from ${ler})
    select distribuidora, any_value(cnpj) as cnpj, conjunto_id, any_value(conjunto) as conjunto, ano,
      max(v) filter (where ind = 'DEC') as dec_limite,
      max(v) filter (where ind = 'FEC') as fec_limite
    from d group by distribuidora, conjunto_id, ano`);
  const n = await contar(banco, "select * from energia_continuidade_limites");
  const [faixa] = await banco.consultar<{ a: number; b: number }>(
    "select min(ano) a, max(ano) b from energia_continuidade_limites",
  );
  await registrarProveniencia(banco, {
    conjunto: "energia.continuidade_limites",
    fonte: ANEEL.nome,
    url_origem: PAGINA(p),
    licenca: ANEEL.licenca,
    data_referencia: `${faixa?.a} a ${faixa?.b} (anual; inclui limites já definidos para anos futuros)`,
    linhas: n,
    observacao: `Fonte atualizada em ${p.metadata_modified.slice(0, 10)}. ${linhasBrutas} linhas no original (com repetições), agrupadas por distribuidora, conjunto e ano.`,
  });
  log(`ANEEL: energia.continuidade_limites gravado (${n} linhas, ${faixa?.a}–${faixa?.b}).`);
}

async function conjuntosMunicipios(banco: Banco, log: (m: string) => void) {
  const p = await pacoteCkan(CKAN, "indqual-municipio");
  const r = recurso(p, "CSV", "indqual-municipio");
  const arq = await baixarArquivo(r.url, "aneel", "indqual-municipio.csv", log);
  // este arquivo vem em Latin-1, diferente dos demais
  await banco.exec(`
    create or replace table energia_conjuntos_municipios as
    select distinct cast(IdeConjUnidConsumidoras as varchar) as conjunto_id,
      cast(CodMunicipio as varchar) as codigo_ibge, trim(NomMunicipio) as municipio, trim(SigUF) as uf
    from read_csv(${lit(arq)}, delim = ';', header = true, encoding = 'latin-1',
      types = {'IdeConjUnidConsumidoras': 'VARCHAR', 'CodMunicipio': 'VARCHAR'})`);
  const n = await contar(banco, "select * from energia_conjuntos_municipios");
  const foraIbge = await contar(
    banco,
    `select distinct codigo_ibge from energia_conjuntos_municipios
     where codigo_ibge not in (select codigo_ibge from territorio_municipios)`,
  ).catch(() => -1); // território pode não ter sido coletado
  await registrarProveniencia(banco, {
    conjunto: "energia.conjuntos_municipios",
    fonte: ANEEL.nome,
    url_origem: PAGINA(p),
    licenca: ANEEL.licenca,
    data_referencia: `Relação vigente na publicação (${p.metadata_modified.slice(0, 10)})`,
    linhas: n,
    observacao:
      foraIbge > 0
        ? `${foraIbge} código(s) de município que não existem na divisão atual do IBGE (mantidos como publicados).`
        : null,
  });
  log(`ANEEL: energia.conjuntos_municipios gravado (${n} linhas${foraIbge > 0 ? `, ${foraIbge} códigos fora do IBGE atual` : ""}).`);
}

async function balanco(banco: Banco, log: (m: string) => void) {
  const p = await pacoteCkan(CKAN, "samp-balanco");
  const r = recurso(p, "PARQUET", "samp-balanco");
  const arq = await baixarArquivo(r.url, "aneel", "samp-balanco.parquet", log);
  const linhasBrutas = await contar(banco, `select * from read_parquet(${lit(arq)})`);
  await banco.exec(`
    create or replace table energia_balanco as
    select distinct
      trim(NomAgente) as distribuidora, ${cnpj("NumCPFCNPJ")} as cnpj,
      trim(DscClassificacaoAgente) as classificacao,
      cast(AnoReferenciaBalanco as integer) as ano, cast(MesReferenciaBalanco as integer) as mes,
      printf('%04d-%02d', AnoReferenciaBalanco, MesReferenciaBalanco) as periodo,
      trim(DscFluxoEnergia) as fluxo, trim(DscModalidadeBalanco) as modalidade,
      trim(DscCctBalanco) as item, trim(DscDetalheBalanco) as detalhe,
      cast(VlrEnergia as bigint) as energia_kwh
    from read_parquet(${lit(arq)})`);
  const n = await contar(banco, "select * from energia_balanco");
  const [faixa] = await banco.consultar<{ a: string; b: string }>(
    "select min(periodo) a, max(periodo) b from energia_balanco",
  );
  await registrarProveniencia(banco, {
    conjunto: "energia.balanco",
    fonte: ANEEL.nome,
    url_origem: PAGINA(p),
    licenca: ANEEL.licenca,
    data_referencia: `${faixa?.a} a ${faixa?.b} (mensal)`,
    linhas: n,
    observacao: `Fonte atualizada em ${p.metadata_modified.slice(0, 10)}. ${linhasBrutas - n} linhas repetidas no arquivo original removidas.`,
  });
  log(`ANEEL: energia.balanco gravado (${n} linhas, ${faixa?.a}–${faixa?.b}; ${linhasBrutas - n} repetidas removidas).`);
}
