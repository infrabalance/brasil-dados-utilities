import { describe, expect, it } from "vitest";
import { Banco } from "../src/banco/db.ts";
import { Consulta } from "../src/consulta/schema.ts";
import { montarSql } from "../src/consulta/sql.ts";
import { buscar, CONJUNTOS, DOMINIOS } from "../src/dominios/catalogo.ts";

describe("catálogo", () => {
  it("ids de conjunto são únicos e começam pelo domínio", () => {
    const ids = DOMINIOS.flatMap((d) => d.conjuntos.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of DOMINIOS) for (const c of d.conjuntos) expect(c.id.startsWith(`${d.id}.`)).toBe(true);
  });

  for (const c of CONJUNTOS.values()) {
    it(`${c.id}: chave, ordenação e campo de tempo existem nos campos`, () => {
      const nomes = new Set(c.campos.map((f) => f.nome));
      expect(new Set(c.campos.map((f) => f.nome)).size).toBe(c.campos.length);
      for (const k of [...c.chave, ...c.ordenacaoPadrao]) expect(nomes).toContain(k);
      if (c.campoTempo) expect(nomes).toContain(c.campoTempo);
      expect(c.exemplos.length).toBeGreaterThan(0);
    });

    for (const ex of c.exemplos) {
      it(`${c.id}: exemplo "${ex.descricao}" é uma consulta válida`, () => {
        const q = Consulta.parse(ex.consulta);
        expect(q.conjunto).toBe(c.id);
        expect(() => montarSql(c, q)).not.toThrow();
      });
    }
  }

  it.each([
    ["DEC", "energia.continuidade"],
    ["perdas de energia", "energia.balanco"],
    ["nível dos reservatórios", "energia.reservatorios"],
    ["carga do nordeste", "energia.carga"],
    ["população", "territorio.municipios"],
    ["perdas de água", "saneamento.indicadores"],
    ["tratamento de esgoto", "saneamento.indicadores"],
    ["estação fluviométrica", "agua.estacoes"],
    ["régua do rio", "agua.estacoes"],
    ["área de risco de deslizamento", "territorio.risco_setores"],
    ["polígono do município", "territorio.malha_municipios"],
    ["série histórica de cota", "agua.cotas"],
    ["vazão diária do rio", "agua.vazoes"],
    ["chuva diária", "agua.chuvas"],
    ["nível atual do rio agora", "agua.telemetria"],
    ["telemetria", "agua.telemetria"],
    ["hidrelétricas do Pará", "energia.usinas"],
    ["parque eólico", "energia.usinas"],
  ])("busca %s → %s em primeiro", (termo, esperado) => {
    expect(buscar(termo)[0]?.conjunto.id).toBe(esperado);
  });
});

describe("tipos de saída", () => {
  it("DATE sai AAAA-MM-DD, TIMESTAMP sai ISO, BIGINT sai number, NaN sai null", async () => {
    const b = await Banco.abrir(":memory:");
    const [l] = await b.consultar(
      "select date '2026-11-14' d, timestamp '2026-11-14 10:30:00' t, 5000000000::bigint n, 'nan'::double x",
    );
    expect(l).toEqual({ d: "2026-11-14", t: "2026-11-14T10:30:00.000Z", n: 5000000000, x: null });
  });
});

describe("campo geometria", () => {
  it("fica fora por padrão, vem como objeto quando pedido e não aceita filtro", async () => {
    const { executarConsulta } = await import("../src/consulta/executar.ts");
    const { registrarProveniencia } = await import("../src/banco/db.ts");
    const b = await Banco.abrir(":memory:");
    await b.exec(`create table territorio_malha as select '4205407' codigo_ibge, 'Florianópolis' nome, 'SC' uf,
      '{"type":"Point","coordinates":[-48.5,-27.6]}' geometria`);
    await registrarProveniencia(b, {
      conjunto: "territorio.malha_municipios", fonte: "IBGE", url_origem: "t", licenca: "t",
      data_referencia: null, linhas: 1, observacao: null,
    });
    const sem = await executarConsulta(b, { conjunto: "territorio.malha_municipios" });
    expect(Object.keys(sem.dados[0]!)).not.toContain("geometria");
    const com = await executarConsulta(b, { conjunto: "territorio.malha_municipios", campos: ["codigo_ibge", "geometria"] });
    expect(com.dados[0]!.geometria).toEqual({ type: "Point", coordinates: [-48.5, -27.6] });
    await expect(
      executarConsulta(b, { conjunto: "territorio.malha_municipios", filtros: { geometria: "x" } }),
    ).rejects.toThrow(/não aceita filtro/);
  });
});

describe("filtros espaciais", () => {
  it("perto: filtra pelo raio, acrescenta distancia_km e ordena por ela", async () => {
    const { executarConsulta } = await import("../src/consulta/executar.ts");
    const { registrarProveniencia } = await import("../src/banco/db.ts");
    const b = await Banco.abrir(":memory:");
    // Florianópolis centro, ~8 km (Palhoça) e ~150 km (Blumenau)
    await b.exec(`create table agua_estacoes as select * from (values
      ('1', 'CENTRO', -27.5954, -48.5480), ('2', 'PALHOCA', -27.6450, -48.6700), ('3', 'BLUMENAU', -26.9194, -49.0661)
    ) t(codigo, nome, latitude, longitude)`);
    await registrarProveniencia(b, {
      conjunto: "agua.estacoes", fonte: "ANA", url_origem: "t", licenca: "t", data_referencia: null, linhas: 3, observacao: null,
    });
    const r = await executarConsulta(b, {
      conjunto: "agua.estacoes", campos: ["codigo", "nome"], perto: { latitude: -27.5954, longitude: -48.548, raio_km: 20 },
    });
    expect(r.dados.map((d) => d.codigo)).toEqual(["1", "2"]);
    expect(r.total).toBe(2);
    expect(r.dados[0]!.distancia_km).toBe(0);
    expect(Number(r.dados[1]!.distancia_km)).toBeGreaterThan(10);
    expect(Number(r.dados[1]!.distancia_km)).toBeLessThan(15);
  });

  it("perto e contendo_ponto exigem coordenadas/geometria no conjunto", async () => {
    const { montarSql } = await import("../src/consulta/sql.ts");
    const mun = CONJUNTOS.get("territorio.municipios")!;
    expect(() => montarSql(mun, Consulta.parse({ conjunto: mun.id, perto: { latitude: 0, longitude: 0, raio_km: 1 } }))).toThrow(/latitude/);
    expect(() => montarSql(mun, Consulta.parse({ conjunto: mun.id, contendo_ponto: { latitude: 0, longitude: 0 } }))).toThrow(/geometria/);
    expect(() => Consulta.parse({ conjunto: mun.id, perto: { latitude: 0, longitude: 0, raio_km: 9999 } })).toThrow();
  });
});

describe("ontologia", () => {
  it("Turtle é RDF válido e JSON-LD tem os conceitos-chave", async () => {
    const { Parser } = await import("n3");
    const { ontologiaTurtle, ontologiaJsonLd, buscarConceitos } = await import("../src/ontologia/ontologia.ts");
    const b = await Banco.abrir(":memory:");
    const ttl = await ontologiaTurtle(b);
    const triplas = new Parser().parse(ttl);
    expect(triplas.length).toBeGreaterThan(100);
    const jsonld = await ontologiaJsonLd(b);
    const ids = jsonld["@graph"].map((c) => c["@id"]);
    for (const id of ["bdu:Municipio", "bdu:Distribuidora", "bdu:ConjuntoEletrico", "bdu:Indicador_DEC", "bdu:SetorDeRisco"]) {
      expect(ids).toContain(id);
    }
    // todo conceito aponta para conjuntos que existem
    for (const c of jsonld["@graph"]) {
      for (const o of c["bdu:encontradoEm"]) expect(CONJUNTOS.has(o["bdu:conjunto"])).toBe(true);
    }
    expect((await buscarConceitos(b, "SAIDI"))[0]?.id).toBe("Indicador_DEC");
  });
});
