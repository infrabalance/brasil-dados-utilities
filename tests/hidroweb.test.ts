import { afterEach, describe, expect, it, vi } from "vitest";
import {
  anosPorVariavel, campo, coletorHidroweb, desdobrarMensal, lerEstacoes, lerTelemetrico, nivelConsistencia,
} from "../src/coletores/hidroweb.ts";
import { baixar } from "../src/coletores/http.ts";

/** Registro mensal no formato da API (só os dias informados; o resto vem null). */
function mes(dados: Record<string, unknown>, dias: Record<number, [string | null, string]>, prefixo = "Cota") {
  const r: Record<string, unknown> = { codigoestacao: "14990000", Data_Ultima_Alteracao: "2019-12-03 00:00:00.0", ...dados };
  for (let d = 1; d <= 31; d++) {
    const dd = String(d).padStart(2, "0");
    r[`${prefixo}_${dd}`] = dias[d]?.[0] ?? null;
    r[`${prefixo}_${dd}_Status`] = dias[d]?.[1] ?? "0";
  }
  return r;
}

describe("Hidroweb · transformações", () => {
  it("campo ignora maiúsculas e sublinhado (a API usa nivelconsistencia e Nivel_Consistencia)", () => {
    expect(campo({ nivelconsistencia: "2" }, "Nivel_Consistencia")).toBe("2");
    expect(campo({ Nivel_Consistencia: "1" }, "nivelconsistencia")).toBe("1");
    expect(campo({}, "x")).toBeUndefined();
  });

  it("nível de consistência: 1 bruto, 2 consistido, outro valor é erro", () => {
    expect(nivelConsistencia("1")).toBe("bruto");
    expect(nivelConsistencia(2)).toBe("consistido");
    expect(() => nivelConsistencia("3")).toThrow(/desconhecido/);
    expect(() => nivelConsistencia(null)).toThrow();
  });

  it("desdobra o mês em dias, sem dias inexistentes nem dias vazios", () => {
    const fev = mes(
      { Data_Hora_Dado: "2013-02-01 00:00:00.0", nivelconsistencia: "2", Mediadiaria: "1", Tipo_Medicao_Cotas: "1" },
      { 1: ["2222.0", "1"], 2: ["2230.5", "2"], 28: ["2476.0", "1"], 29: ["9999", "1"], 30: ["9999", "1"] },
    );
    const dias = desdobrarMensal(fev, "cota");
    expect(dias.map((d) => d.data)).toEqual(["2013-02-01", "2013-02-02", "2013-02-28"]);
    expect(dias[1]).toEqual({
      codigo: "14990000", data: "2013-02-02", valor: 2230.5, status: "2",
      nivel_consistencia: "consistido", tipo_medicao: "1", atualizado_em: "2019-12-03",
    });
  });

  it("ano bissexto mantém 29/02", () => {
    const fev = mes({ Data_Hora_Dado: "2024-02-01 00:00:00.0", Nivel_Consistencia: "1" }, { 29: ["10.4", "1"] }, "Chuva");
    expect(desdobrarMensal(fev, "chuva").map((d) => d.data)).toEqual(["2024-02-29"]);
  });

  it("cotas: descarta as leituras das 7 h/17 h (Mediadiaria = 0) e fica com a média diária", () => {
    const leitura = mes({ Data_Hora_Dado: "2013-01-01 07:00:00.0", nivelconsistencia: "1", Mediadiaria: "0" }, { 1: ["1883.0", "1"] });
    const media = mes({ Data_Hora_Dado: "2013-01-01 00:00:00.0", nivelconsistencia: "1", Mediadiaria: "1" }, { 1: ["1886.5", "1"] });
    expect(desdobrarMensal(leitura, "cota")).toEqual([]);
    expect(desdobrarMensal(media, "cota")[0]?.valor).toBe(1886.5);
  });

  it("registro sem data de referência é erro (não inventa mês)", () => {
    expect(() => desdobrarMensal(mes({ nivelconsistencia: "1" }, { 1: ["1", "1"] }), "cota")).toThrow(/Data_Hora_Dado/);
  });

  it("telemetria: números, status como texto e horário sem fuso inventado", () => {
    expect(
      lerTelemetrico({
        codigoestacao: "29050000", Data_Hora_Medicao: "2026-11-15 22:15:00.0", Data_Atualizacao: "2026-11-15 22:31:40.95",
        Chuva_Adotada: "0.00", Chuva_Adotada_Status: "0", Cota_Adotada: "255.00", Cota_Adotada_Status: "0",
        Vazao_Adotada: null, Vazao_Adotada_Status: null,
      }),
    ).toEqual({
      codigo: "29050000", data_hora: "2026-11-15 22:15:00", atualizado_em: "2026-11-15 22:31:40",
      chuva_mm: 0, chuva_status: "0", cota_cm: 255, cota_status: "0", vazao_m3s: null, vazao_status: null,
    });
    expect(lerTelemetrico({ codigoestacao: "1", Data_Hora_Medicao: null })).toBeNull();
  });

  it("anos a pedir saem dos períodos do inventário", () => {
    const inv = {
      Data_Periodo_Escala_Inicio: "2010-09-01 00:00:00.0", Data_Periodo_Escala_Fim: "2014-06-01 00:00:00.0",
      Data_Periodo_Registrador_Nivel_Inicio: null, Data_Periodo_Desc_liquida_Inicio: "2008-04-01 00:00:00.0",
      Data_Periodo_Pluviometro_Inicio: "2024-01-01 00:00:00.0", Data_Periodo_Pluviometro_Fim: null,
    };
    const a = anosPorVariavel(inv, 2026);
    expect(a.cota).toEqual([2010, 2011, 2012, 2013, 2014]);
    expect(a.vazao).toEqual(a.cota);
    expect(a.chuva).toEqual([2024, 2025, 2026]); // sem fim = em operação até hoje
    expect(anosPorVariavel({ Data_Periodo_Escala_Inicio: "2020-01-01" }, 2026).vazao).toEqual([]); // sem descarga, sem vazão
  });
});

describe("Hidroweb · configuração", () => {
  it("lista de estações: variável de ambiente tem precedência, sem repetidos", () => {
    expect(lerEstacoes({ BDU_HIDROWEB_ESTACOES: " 14990000,549013,14990000 " })).toEqual(["14990000", "549013"]);
  });

  it("recusa código inválido (nada de texto livre na URL)", () => {
    expect(() => lerEstacoes({ BDU_HIDROWEB_ESTACOES: "14990000,abc&x=1" })).toThrow(/inválido/);
  });

  it("arquivo padrão do repositório é válido", () => {
    expect(lerEstacoes({}).length).toBeGreaterThan(0);
  });

  it("sem credencial o coletor se declara indisponível (coletar todos segue sem ele)", () => {
    const antes = { ...process.env };
    delete process.env.ANA_HIDRO_IDENTIFICADOR;
    delete process.env.ANA_HIDRO_SENHA;
    try {
      expect(coletorHidroweb.indisponivel?.()).toMatch(/credencial/);
      process.env.ANA_HIDRO_IDENTIFICADOR = "u";
      process.env.ANA_HIDRO_SENHA = "s";
      expect(coletorHidroweb.indisponivel?.()).toBeNull();
    } finally {
      process.env = antes;
    }
  });
});

describe("Hidroweb · credencial no cabeçalho", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("com cabeçalhos não segue redirecionamento e o segredo não aparece no erro", async () => {
    const chamadas: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      chamadas.push(init);
      return new Response("{}", { status: 401 });
    });
    const erro = await baixar("https://www.ana.gov.br/x", { cabecalhos: { Authorization: "Bearer SEGREDO" }, tentativas: 1 })
      .catch((e: Error) => e);
    expect(chamadas[0]?.redirect).toBe("error");
    expect((chamadas[0]?.headers as Record<string, string>).Authorization).toBe("Bearer SEGREDO");
    expect(String(erro)).toMatch(/HTTP 401/);
    expect(String(erro)).not.toMatch(/SEGREDO/);
  });
});
