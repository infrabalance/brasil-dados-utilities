# Segurança e confiabilidade dos dados

Um projeto que leva dado externo a agentes de IA tem dois riscos principais. O primeiro é o servidor ser atacado. O segundo, mais sutil, é **entregar dado errado com cara de certo**. Para um projeto que quer ser referência, o segundo é o que mais pesa.

Este documento lista os riscos que consideramos e o controle que existe no código para cada um. Cada controle tem teste em `tests/seguranca.test.ts`.

## 1. Riscos de dado (credibilidade)

| Risco | Controle | Onde |
|---|---|---|
| Baixar de origem não oficial (URL trocada, redirecionamento, link injetado numa página raspada) | Só HTTPS e só hosts oficiais (`*.gov.br`, `dados.ons.org.br` e o bucket S3 do ONS). O destino final de redirecionamentos também é conferido. URL com usuário/senha é recusada. | `src/coletores/http.ts` |
| Arquivo corrompido, truncado ou trocado na origem | Download vai para arquivo temporário e só é renomeado completo. SHA-256 calculado no caminho e gravado na proveniência com URL e tamanho. Arquivo vazio é recusado. | `src/coletores/arquivos.ts` |
| Arquivo gigante ou zip bomb | Teto por download (`BDU_MAX_ARQUIVO_MB`, padrão 2048) e por arquivo descompactado (300 MB). Teto de 200 MB para respostas de API. | `arquivos.ts`, `http.ts`, `sinisa.ts` |
| A fonte muda de formato e o coletor grava lixo | **Portões de qualidade** antes de publicar: todo campo do catálogo existe; tabela não vazia (só alerta nas séries por estação, onde vazio é legítimo); chave declarada é única e sem nulo; não houve queda maior que 20% em relação à coleta anterior (`BDU_QUEDA_MAXIMA`); campo de tempo preenchido (só alerta). | `src/qualidade/verificar.ts` |
| Coleta que falha no meio deixa o banco pela metade | Cada domínio é coletado **numa transação**. Se a coleta ou um portão falhar, nada muda: o servidor continua com a versão anterior, já conferida. Para aceitar uma queda legítima: `npm run coletar -- <dominio> --forcar` (fica registrado como `forcado: true`). | `src/coletores/cli.ts` |
| Credencial de fonte (Hidroweb) vaza | Fica só no `.env` (fora do git). Vai no cabeçalho, nunca na URL; com credencial o download **não segue redirecionamento** (o cabeçalho iria junto). Não entra em log, erro, banco nem proveniência. Sem credencial o coletor é pulado. Lista de estações só aceita códigos numéricos. | `src/coletores/hidroweb.ts`, `http.ts` |
| Ninguém consegue auditar de onde veio um número | Toda resposta traz `proveniencia` com fonte, licença, URL, data de referência, data da coleta, `arquivos` (URL, bytes, SHA-256) e `verificacoes` (cada portão, aprovado ou não). | `_proveniencia` |
| Dado defasado apresentado como atual | `data_referencia` explícita em toda resposta e avisos de defasagem no catálogo. | `src/dominios/*` |
| Indicador "calculado por nós" confundido com oficial | O projeto não calcula indicador regulatório; o guia instrui o agente a deixar claro quando faz uma conta própria. | `docs/guia-agentes.md` |

Os portões já pegaram problemas reais na primeira execução (15/11/2026):

- **DEC/FEC (ANEEL):** 7.178 linhas sem conjunto e sem nenhum valor. Vinham de registros `NumConsAgt` (consumidores por distribuidora, 2000–2012) que o pivô transformava em linhas vazias. Agora ficam de fora e a proveniência diz quantas são.
- **Balanço (ANEEL):** a fonte atribui o mesmo CNPJ a agentes diferentes em 8 casos (ex.: ARATU-G e ELEKTRO-GER em 2007). A chave passou a incluir o nome do agente e o catálogo ganhou o aviso.

## 2. Riscos para o agente (injeção indireta de prompt)

O texto publicado pelos órgãos (descrições de setores de risco, nomes de estação etc.) chega ao contexto do modelo. Um texto malicioso ou apenas estranho na fonte poderia ser lido como instrução.

- **Limpeza na saída:** caracteres de controle, marcas de direção bidi, caracteres de largura zero, BOM e *tag characters* Unicode (usados para esconder texto de humanos) são removidos de todo campo de texto, e o texto é normalizado em NFC. A resposta avisa quantos caracteres saíram. O texto visível não muda. Código em `src/seguranca/texto.ts`.
- **Moldura explícita:** as instruções do servidor MCP e a resposta de `consultar` dizem que os campos de texto são dado, nunca instrução (`aviso_conteudo`). O guia repete a regra.
- **Sem efeitos colaterais:** nenhuma ferramenta escreve, apaga, envia ou acessa a web. Mesmo um agente enganado só consegue ler dado público.

## 3. Riscos do servidor

| Risco | Controle |
|---|---|
| Injeção de SQL | Nomes de campo só vêm do catálogo; valores sempre como parâmetro; Zod estrito recusa chave desconhecida. |
| Consulta que escapa e lê arquivo ou rede | No modo servidor o DuckDB abre **só leitura**, carrega a `spatial` e então desliga o acesso externo (`enable_external_access = false`), a instalação e o carregamento automático de extensões, e **trava a configuração** (`lock_configuration`). Nenhum `SET` desfaz isso. |
| Consulta pesada derruba o servidor | Tempo limite por consulta com interrupção (`BDU_TEMPO_CONSULTA_MS`, padrão 15 s), no máximo 4 consultas ao mesmo tempo (`BDU_CONSULTAS_SIMULTANEAS`), teto de memória opcional (`BDU_MEMORIA`, ex.: `2GB`), limite de 5.000 linhas e limites de tamanho em todos os campos da consulta. |
| Abuso / robô | Limite por cliente: 120 requisições por minuto (`BDU_LIMITE_POR_MINUTO`), com cabeçalhos `ratelimit-*` e `retry-after`. Corpo máximo de 64 KB. Tempo limite de cabeçalho e de requisição (contra slowloris). |
| DNS rebinding (site malicioso falando com o servidor local) | O servidor ouve só em `127.0.0.1` por padrão, confere o cabeçalho `Host` e, no `/mcp`, recusa `Origin` de navegador fora da lista, como manda a especificação MCP. |
| Vazamento de detalhe interno | Erro interno responde mensagem genérica; o detalhe vai só para o log (stderr). |
| Cabeçalhos | `nosniff`, `X-Frame-Options`, HSTS, `Referrer-Policy` e afins (`secureHeaders`). CORS aberto só para leitura (dado público, sem cookies). |

## 4. Cadeia de suprimentos do código

- Versões exatas no `package.json` e `package-lock.json` versionado; `npm ci` no CI.
- CI: `npm audit --audit-level=moderate` e `npm audit signatures` (assinaturas/atestados dos pacotes) a cada push.
- Actions fixadas por **commit**, não por tag; `permissions: contents: read`; checkout sem credenciais persistidas.
- Dependabot semanal (npm e Actions). CodeQL (`security-extended`) quando o repositório for público.
- Dependências de produção mínimas: DuckDB, Hono, SDK MCP, Zod, fflate, tsx.

## 5. Publicar o servidor

Padrão seguro para uso local: `npm start`, que ouve só em `127.0.0.1`. Para expor:

```bash
HOST=0.0.0.0 \
BDU_HOSTS=dados.exemplo.com.br \
BDU_ORIGENS_MCP=https://app.exemplo.com.br \
BDU_CONFIAR_PROXY=1 \
BDU_MEMORIA=2GB \
npm start
```

- Coloque um proxy com TLS na frente (Caddy, nginx, CDN) e limite a taxa lá também.
- `BDU_CONFIAR_PROXY=1` só se o proxy for seu: ele faz o servidor usar `X-Forwarded-For` para o limite por cliente.
- Rode a coleta em outro processo ou máquina e publique o arquivo `.duckdb` pronto. O servidor nunca precisa de permissão de escrita no banco.
- Não há segredo no projeto: não existe chave, token ou dado privado para vazar.

## 6. Limites conhecidos

- O SHA-256 prova que o arquivo usado é o que foi baixado. Ele não prova que o órgão publicou o arquivo certo: nenhuma das fontes publica hash ou assinatura. Erros da fonte são tratados com aviso e transparência, não escondidos.
- O limite de taxa vive em memória, por processo. Com várias instâncias, limite no proxy.
- A limpeza de texto remove o que é invisível. Ela não detecta um texto visível escrito para enganar o modelo; por isso existe a moldura "dado, não instrução" e a ausência de ferramentas com efeito.
