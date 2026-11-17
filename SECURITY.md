# Política de segurança

Brasil Dados Utilities é mantido pela [Balance.ia](https://balance.ia.br). Levamos a sério duas coisas: a segurança de quem roda o servidor e a **integridade dos dados** que ele entrega a pessoas e agentes de IA.

## Como relatar

**Não abra issue pública** para vulnerabilidade. Use o relato privado do GitHub (aba *Security* → *Report a vulnerability*) neste repositório.

Inclua o que for possível: versão ou commit, passos para reproduzir, impacto esperado. Respondemos em até 5 dias úteis e combinamos com você a data de divulgação.

## O que está no escopo

- Execução de código, leitura de arquivos ou acesso à rede a partir de uma consulta (`POST /query`, ferramentas MCP).
- Contornar as proteções do servidor: validação de Host/Origin, limite de taxa, limite de corpo, tempo limite de consulta.
- **Integridade de dado**: um caminho em que o coletor aceite dado de origem não oficial, dado corrompido ou dado que deveria ter sido barrado pelos portões de qualidade.
- Conteúdo da fonte que chegue ao agente de forma a se passar por instrução (injeção indireta de prompt) apesar da limpeza.

## O que não está no escopo

- Erros nos dados **publicados pelos próprios órgãos** (ANEEL, ONS, SINISA, ANA, SGB, IBGE). Esses viram issue comum, com o link da fonte: corrigimos o tratamento ou registramos o aviso, e avisamos o órgão quando couber.
- Ataques de negação de serviço volumétricos contra uma instância pública (use CDN/proxy na frente).

## Versões

Só a versão mais recente da branch `main` recebe correções.

Os controles e a configuração segura estão em [docs/SEGURANCA.md](docs/SEGURANCA.md).
