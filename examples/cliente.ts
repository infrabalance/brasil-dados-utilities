/**
 * Cliente mínimo em TypeScript (Node 22+, sem dependências).
 * Rode com o servidor no ar:  npx tsx examples/cliente.ts
 */
const BASE = process.env.BDU_URL ?? "http://localhost:3010";

async function consultar<T = Record<string, unknown>>(consulta: object) {
  const r = await fetch(`${BASE}/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(consulta),
  });
  const corpo = await r.json();
  if (!r.ok) throw new Error(`${corpo.erro.codigo}: ${corpo.erro.mensagem}`);
  return corpo as { dados: T[]; total: number; proveniencia: { atribuicao: string; data_referencia: string }; avisos: string[] };
}

// 1) código IBGE pelo nome
const { dados: [cidade] } = await consultar<{ codigo_ibge: string; nome: string; populacao_2022: number }>({
  conjunto: "territorio.municipios",
  campos: ["codigo_ibge", "nome", "populacao_2022"],
  filtros: { nome: { op: "contem", valor: "Blumenau" }, uf: "SC" },
});
console.log(`${cidade!.nome}: ${cidade!.populacao_2022.toLocaleString("pt-BR")} habitantes (Censo 2022)`);

// 2) perdas de água e cobertura de esgoto (SINISA)
const san = await consultar<{ ano: number; indicador: string; indicador_nome: string; valor: number | null; unidade: string }>({
  conjunto: "saneamento.indicadores",
  campos: ["ano", "indicador", "indicador_nome", "valor", "unidade"],
  filtros: { codigo_ibge: cidade!.codigo_ibge, indicador: ["IAG2013", "IES0001"] },
});
for (const l of san.dados) console.log(`  ${l.ano} ${l.indicador} ${l.indicador_nome}: ${l.valor ?? "não calculado"} ${l.unidade}`);
console.log(`  ${san.proveniencia.atribuicao}`);

// 3) setores de risco e estações telemétricas
const risco = await consultar<{ tipologia: string; grau_risco: string; pessoas: number }>({
  conjunto: "territorio.risco_setores",
  campos: ["tipologia", "grau_risco", "pessoas"],
  filtros: { codigo_ibge: cidade!.codigo_ibge },
  limite: 5000,
});
console.log(`  ${risco.total} setores de risco mapeados pelo SGB`);

const estacoes = await consultar<{ nome: string; rio: string | null; distancia_km: number }>({
  conjunto: "agua.estacoes",
  campos: ["nome", "rio"],
  filtros: { tipo: "Fluviométrica", telemetrica: true, operando: true },
  perto: { latitude: -26.9194, longitude: -49.0661, raio_km: 25 },
  limite: 5,
});
for (const e of estacoes.dados) console.log(`  estação ${e.nome} (${e.rio ?? "—"}) a ${e.distancia_km} km`);
