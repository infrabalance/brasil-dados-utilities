import { registrarProveniencia, type Banco } from "../banco/db.ts";
import { ONS } from "../dominios/fontes.ts";
import { baixarArquivo, lit, pacoteCkan } from "./arquivos.ts";
import type { Coletor } from "./tipos.ts";

const CKAN = "https://dados.ons.org.br";

/** Um parquet por ano; baixa todos (com cache) e devolve os caminhos locais. */
async function parquetsAnuais(id: string, log: (m: string) => void) {
  const p = await pacoteCkan(CKAN, id);
  const anuais = p.resources.filter((r) => r.format.toUpperCase() === "PARQUET" && /\d{4}/.test(r.name));
  if (anuais.length === 0) throw new Error(`ONS ${id}: nenhum parquet anual encontrado (a fonte mudou?)`);
  log(`ONS ${id}: ${anuais.length} arquivos anuais`);
  const anoAtual = String(new Date().getFullYear());
  const locais: string[] = [];
  for (const r of anuais) {
    const nome = r.url.split("/").pop()!;
    // ano corrente muda todo dia; anos anteriores ao passado não mudam mais
    const fechado = Number(nome.match(/(\d{4})/)?.[1]) < Number(anoAtual) - 1;
    locais.push(await baixarArquivo(r.url, "ons", nome, log, fechado ? { validadeMs: Infinity } : {}));
  }
  return { pacote: p, locais };
}

async function faixaDatas(banco: Banco, tabela: string) {
  const [r] = await banco.consultar<{ a: string; b: string; n: number }>(
    `select min(data)::varchar a, max(data)::varchar b, count(*)::bigint n from ${tabela}`,
  );
  return { a: r?.a, b: r?.b, n: Number(r?.n ?? 0) };
}

export const coletorOns: Coletor = {
  id: "ons",
  dominio: "energia",
  conjuntos: ["energia.carga", "energia.reservatorios"],

  async coletar(banco, log) {
    // carga diária por subsistema
    {
      const { pacote, locais } = await parquetsAnuais("carga-energia", log);
      const [vazios] = await banco.consultar<{ n: number }>(
        `select count(*)::bigint n from read_parquet([${locais.map(lit).join(", ")}], union_by_name = true)
         where try_cast(val_cargaenergiamwmed as double) is null`,
      );
      await banco.exec(`
        create or replace table energia_carga as
        select distinct cast(din_instante as date) as data, trim(id_subsistema) as subsistema_id,
          trim(nom_subsistema) as subsistema, try_cast(val_cargaenergiamwmed as double) as carga_mwmed
        from read_parquet([${locais.map(lit).join(", ")}], union_by_name = true)
        -- alguns anos vêm com o valor como texto e dias com valor vazio (às vezes o mesmo dia de novo com valor)
        where try_cast(val_cargaenergiamwmed as double) is not null`);
      const f = await faixaDatas(banco, "energia_carga");
      await registrarProveniencia(banco, {
        conjunto: "energia.carga",
        fonte: ONS.nome,
        url_origem: `${CKAN}/dataset/${pacote.name}`,
        licenca: ONS.licenca,
        data_referencia: `${f.a} a ${f.b} (diária)`,
        linhas: f.n,
        observacao: vazios?.n ? `${vazios.n} registro(s) sem valor de carga no original foram descartados.` : null,
      });
      log(`ONS: energia.carga gravado (${f.n} linhas, ${f.a}–${f.b}).`);
    }

    // energia armazenada (EAR) diária por subsistema
    {
      const { pacote, locais } = await parquetsAnuais("ear-diario-por-subsistema", log);
      await banco.exec(`
        create or replace table energia_reservatorios as
        select distinct cast(ear_data as date) as data, trim(id_subsistema) as subsistema_id,
          trim(nom_subsistema) as subsistema,
          try_cast(ear_max_subsistema as double) as ear_max_mwmes,
          try_cast(ear_verif_subsistema_mwmes as double) as ear_mwmes,
          try_cast(ear_verif_subsistema_percentual as double) as ear_percentual
        from read_parquet([${locais.map(lit).join(", ")}], union_by_name = true)`);
      const f = await faixaDatas(banco, "energia_reservatorios");
      await registrarProveniencia(banco, {
        conjunto: "energia.reservatorios",
        fonte: ONS.nome,
        url_origem: `${CKAN}/dataset/${pacote.name}`,
        licenca: ONS.licenca,
        data_referencia: `${f.a} a ${f.b} (diária)`,
        linhas: f.n,
        observacao: null,
      });
      log(`ONS: energia.reservatorios gravado (${f.n} linhas, ${f.a}–${f.b}).`);
    }
  },
};
