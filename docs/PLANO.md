# Brasil Dados Utilities — plano técnico (v0, para aprovação)

> Projeto open source criado pela **Balance.ia**. API + MCP de dados públicos de **água e energia do Brasil**, feito para quem quer desenvolver em cima.
> Inspirado no [eia-api-ts](https://github.com/maxoliverbr/eia-api-ts) (MIT), escrito do zero.
> **Totalmente apartado do produto Balance**: nenhum código, dado, métrica ou metodologia da Balance. Só dado público oficial, como a fonte publica.

Status: **fases 1 a 4 concluídas em 15/11/2026** (IBGE + malha; energia ANEEL + ONS; saneamento SINISA + estações ANA; risco SGB). Local; GitHub e servidor público depois.

---

## 1. Princípios

1. **Fonte oficial, sempre citada.** Todo valor sai com `fonte`, `dataset`, `url_origem`, `data_referencia` e `coletado_em`.
2. **Não inventa indicador.** Só o que a fonte publica. Nada derivado que pareça metodologia própria.
3. **Defasagem explícita.** SINISA/SNIS são anuais e atrasados; a resposta diz de quando é o dado.
4. **Dado ruim é marcado, não escondido** (`qualidade: "suspeito"` + motivo).
5. **Roda com um comando**, sem banco externo (`docker compose up` ou `npm start`).
6. **Pensado para agentes**: consulta única, autodescrição, guia e ontologia.

## 2. Diferença central para o original

A EIA tem uma API v2 unificada; o original é um proxy tipado. No Brasil, cada fonte publica de um jeito, então aqui há **coleta (ETL) + banco local**, e a API consulta o banco, não a fonte ao vivo.

```
fontes oficiais ──► coletores (ETL agendado) ──► DuckDB local (+ parquet)
                                                     │
                                  ┌──────────────────┴─────────────┐
                               API HTTP (/query, /domains...)    MCP (/mcp)
```

## 3. Fontes — como cada uma é acessada (conferido em 15/11/2026)

| Fonte | Acesso | Licença | Observação |
|---|---|---|---|
| ANEEL | CKAN (`dadosabertos.aneel.gov.br/api/3`), 72 conjuntos; DEC/FEC em **parquet** + CSV de limites e atributos | **ODbL** | ODbL é *share-alike* p/ base derivada → os dados redistribuídos ficam ODbL (código segue MIT) |
| ONS | CKAN (`dados.ons.org.br`), 88 conjuntos; arquivos CSV/XLSX/parquet no S3 por ano | CC-BY | carga, EAR/ENA, geração, CMO, indicadores de confiabilidade |
| SGB | ArcGIS REST (`geoportal.sgb.gov.br/server/rest/services`) | a confirmar por camada | setores de risco, suscetibilidade, SIAGAS; geometria |
| ANA | Hidroweb (serviço com swagger) + SNIRH ArcGIS | a confirmar | réguas, vazão, cota; Hidroweb pode exigir cadastro |
| SINISA/SNIS | planilhas/painel (gov.br/cidades) | a confirmar | sem API; ETL de planilha |
| IBGE | API de localidades + malhas | aberta | dimensão município/UF, chave de junção |

## 4. Domínios da v1

**Energia**
- `energia.continuidade` — DEC/FEC por conjunto e distribuidora (apurado × limite), compensações — ANEEL
- `energia.perdas` — perdas técnicas/não técnicas por distribuidora — ANEEL (conjunto exato a confirmar no CKAN)
- `energia.sistema` — carga por subsistema, EAR/ENA — ONS

**Água e saneamento**
- `saneamento.indicadores` — perdas e atendimento por município/prestador, como publicados — SINISA/SNIS
- `agua.hidrologia` — estações, cota e vazão — ANA

**Território**
- `territorio.risco` — setores de risco geológico/hidrológico — SGB
- `territorio.municipios` — municípios, UF, população — IBGE

## 5. Interface

HTTP:
- `POST /query` — formato único: `{ conjunto: "dominio.conjunto", campos, filtros, inicio, fim, ordenar, limite, deslocamento }`
- `GET /domains`, `GET /domains/:id`, `GET /datasets/:id` — o que existe, campos, exemplos
- `GET /search?q=` — busca por conceito ("DEC", "perda de água", "Porto Alegre")
- `GET /guide` — playbook para agentes (usar como system prompt)
- `GET /ontology` — ontologia do setor (JSON-LD / Turtle)
- `GET /sources` — fontes, licenças, última coleta
- `GET /openapi` — OpenAPI 3.1

MCP (mesmo servidor, `/mcp`, + modo stdio para Claude Desktop):
- tools (fase 1): `listar_dominios`, `descrever_dominio`, `descrever_conjunto`, `buscar`, `consultar`, `fontes`; depois: `comparar_periodos`, `serie_temporal`, `municipio_resumo`
- resources: `guia`, `ontologia`

## 6. Stack proposta

- **TypeScript / Node 22**, **Hono** (HTTP), **Zod** (schemas → OpenAPI), **@modelcontextprotocol/sdk** (MCP)
- **DuckDB** (arquivo único, lê parquet/CSV direto, extensão spatial p/ SGB) — zero infraestrutura para quem clona
- Coletores em TypeScript com agendamento local (`npm run coletar`, cron opcional)
- Testes com Vitest; CI no GitHub Actions quando subir

Por que não copiar Bun + Elysia do original: DuckDB tem binding oficial e estável no Node; Hono rodaria em Bun também se quisermos depois.

## 7. Estrutura

```
brasil-dados-utilities/
  src/
    api/            rotas HTTP
    mcp/            servidor MCP (http + stdio)
    dominios/       definição de cada domínio (schema, campos, exemplos)
    coletores/      um por fonte (aneel, ons, sgb, ana, sinisa, ibge)
    banco/          DuckDB, migrações, catálogo de proveniência
    ontologia/
  docs/             PLANO, guia, fontes, exemplos
  examples/         curl, Claude Desktop, TS client, notebooks
  data/             (gitignored) banco local
  LICENSE (MIT) · DATA_LICENSES.md · README.md (PT) · README.en.md
```

## 8. Marca

README, página e `/` exibem "Criado e mantido por **Balance.ia**" com link para balance.ia.br. Nada além disso do produto.

## 9. Fases

1. ✅ **Esqueleto**: servidor, DuckDB, `/query`, `/domains`, MCP (HTTP + stdio), proveniência — com IBGE. 19 testes.
2. ✅ **Energia**: ANEEL continuidade, limites, conjuntos×municípios e balanço (SAMP); ONS carga e EAR. 45 testes.
3. ✅ **Água**: SINISA (indicadores por município) + ANA (inventário de estações). Séries do Hidroweb: coletor opcional com credencial (16/11/2026).
4. ✅ **Território**: malha municipal IBGE + setores de risco SGB; campo `geometria` (GeoJSON, só quando pedido); estações ANA cruzadas com a malha.
5. **Guia, ontologia, exemplos, README bilíngue**; depois GitHub; servidor público por último.

## 10. Em aberto

- Conjunto exato de perdas de energia na ANEEL (candidatos: SAMP-balanço, BDGD — BDGD é pesada e geográfica, provavelmente fica p/ v2).
- Licença por camada do SGB e termos do Hidroweb/SINISA.
- Ontologia própria ou alinhada a algum vocabulário existente.

## 11. Decisões da fase 1

- Porta padrão **3010**.
- API e MCP abrem o DuckDB **só leitura**; o coletor abre para escrita. O DuckDB não permite as duas coisas em processos diferentes → parar o servidor para coletar. Melhorar depois (ex.: coletar num arquivo novo e trocar).
- `/ontology` fica para a fase 5.
- Banco em `data/bdu.duckdb` relativo à raiz do projeto (o MCP funciona de qualquer pasta).

## 12. Decisões da fase 2

- **Perdas:** a ANEEL não publica técnicas × não técnicas como dado aberto. Usamos o balanço SAMP ("Perdas na Distribuição", medida e faturada). Separação técnica/não técnica fica fora até aparecer fonte aberta.
- **DEC/FEC anual não é calculado** (critério do PRODIST); só os mensais publicados + limites anuais.
- **Compensações por violação** (outro arquivo do mesmo conjunto, ~420 MB) ficaram para depois.
- **Repetições:** todos os arquivos da ANEEL vêm com cada linha duplicada; removemos e registramos a contagem.
- **Meses recentes incompletos** (atraso de envio): aviso na resposta, sem corte automático.
- Cache de download em `data/raw/` (20 h; anos fechados do ONS para sempre).

## 13. Decisões da fase 3

- **SINISA** não tem API: pacotes zip de planilhas por ano de referência nas páginas de resultados. O coletor acha os zips na página, lê só "Indicadores … Base Municipal" e se guia pelos códigos do cabeçalho (layouts de 2023 e 2024 diferem). Água: ref. 2023 e 2024; esgoto: só 2024 (não há pacote de esgoto 2023).
- **Licença SINISA:** gov.br indica CC BY-ND 3.0 para o conteúdo do portal — ponto jurídico em aberto antes de publicar.
- **SNIS antigo** fica de fora (descontinuado, códigos diferentes).
- **ANA:** a API Hidroweb exige login (token de 1 h por usuário). ✅ 16/11/2026: coletor opcional `hidroweb` (credencial no `.env`, lista de estações em `config/hidroweb-estacoes.json`): `agua.cotas`, `agua.vazoes`, `agua.chuvas` (diárias, bruto + consistido) e `agua.telemetria` (último ano). A API ganhou em 2026 um login por SSO (`OAUthPermissoes`, client_id + access token) além do usuário/senha; usamos usuário/senha.
- Estações: `codigo_ibge` por nome; na fase 4 (malha IBGE) dá para associar pela coordenada.

## 14. Decisões da fase 4

- **Geometria** guardada como texto GeoJSON (a API não depende da extensão spatial em tempo de leitura); WKB interno (`_geo_*`) só para cruzamentos na coleta.
- **SGB:** camada `gestaoterritorial/risco` (tem código IBGE). Chave = `objectid` (o código do setor se repete: polígono em partes e códigos reaproveitados entre municípios). Cobertura parcial: municípios com mapeamento estadual/próprio não aparecem.
- **Licença SGB:** sem termo específico — confirmar com o órgão.
- **ANA × município:** coordenada e nome divergem em ~16% (divisas/rios). `codigo_ibge` = registrado pela fonte; `codigo_ibge_coordenada` à parte.
- Ficou para depois: filtro espacial na consulta (ex.: "estações a até X km", "setores que contêm o ponto").

## 15. Decisões de segurança e confiabilidade (15/11/2026)

- Credibilidade antes de frescor: coleta por domínio em transação, com portões de qualidade; falhou, fica a versão anterior.
- Proveniência auditável: URL, bytes e SHA-256 de cada arquivo, mais o resultado de cada portão.
- Só hosts oficiais por HTTPS (`*.gov.br`, `dados.ons.org.br`, bucket S3 do ONS).
- Texto da fonte é dado: limpeza de invisíveis e moldura "dado, não instrução" no MCP e no guia.
- Servidor só leitura, DuckDB sem acesso externo e configuração travada; Host/Origin validados; padrão `127.0.0.1`.
- MCP: anotações completas (só leitura, idempotente, mundo fechado), `structuredContent`, limites de entrada e erro interno sem detalhe.
- Achados da primeira execução dos portões: linhas `NumConsAgt` vazias no DEC/FEC (retiradas e declaradas); CNPJ repetido entre agentes no balanço (chave inclui o agente).
- Detalhes em `docs/SEGURANCA.md`.
