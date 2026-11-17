import { z } from "zod";

export const LIMITE_PADRAO = 100;
export const LIMITE_MAXIMO = 5000;

/** Tetos de tamanho: nenhuma consulta legítima precisa de mais que isso. */
const Texto = z.string().max(500);
const Nome = z.string().max(100);
const Escalar = z.union([Texto, z.number().finite(), z.boolean()]);

export const OPERADORES = ["eq", "ne", "in", "gt", "gte", "lt", "lte", "contem"] as const;

const FiltroOperador = z.object({
  op: z.enum(OPERADORES),
  valor: z.union([Escalar, z.array(Escalar).min(1).max(1000)]),
});

/** Valor direto = igualdade; lista = `in`; objeto = operador explícito. */
export const Filtro = z.union([Escalar, z.array(Escalar).min(1).max(1000), FiltroOperador]);

const Latitude = z.number().min(-90).max(90);
const Longitude = z.number().min(-180).max(180);

export const RAIO_MAXIMO_KM = 500;

export const Consulta = z
  .object({
    conjunto: Nome.describe("Id do conjunto, ex.: territorio.municipios (veja /domains)"),
    campos: z.array(Nome).min(1).max(100).optional().describe("Campos a retornar. Padrão: todos"),
    filtros: z.record(Nome, Filtro).refine((f) => Object.keys(f).length <= 30, "no máximo 30 filtros").optional().describe(
      'Ex.: { "uf": "SC", "populacao_2022": { "op": "gte", "valor": 100000 } }',
    ),
    inicio: Nome.optional().describe("Início do período (inclusive), no formato do campo de tempo"),
    fim: Nome.optional().describe("Fim do período (inclusive)"),
    perto: z
      .object({ latitude: Latitude, longitude: Longitude, raio_km: z.number().positive().max(RAIO_MAXIMO_KM) })
      .strict()
      .optional()
      .describe(
        "Só registros a até raio_km do ponto (conjuntos com latitude/longitude). Acrescenta distancia_km e ordena por ela.",
      ),
    contendo_ponto: z
      .object({ latitude: Latitude, longitude: Longitude })
      .strict()
      .optional()
      .describe("Só registros cujo polígono contém o ponto (conjuntos com geometria), ex.: em qual setor de risco fica um endereço."),
    ordenar: z
      .array(z.object({ campo: Nome, direcao: z.enum(["asc", "desc"]).default("asc") }))
      .max(10)
      .optional(),
    limite: z.number().int().min(1).max(LIMITE_MAXIMO).default(LIMITE_PADRAO),
    deslocamento: z.number().int().min(0).max(10_000_000).default(0),
  })
  .strict();

export type ConsultaEntrada = z.input<typeof Consulta>;
export type ConsultaValidada = z.output<typeof Consulta>;
