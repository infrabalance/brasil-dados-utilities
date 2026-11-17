# Licenças dos dados

O **código** deste projeto é MIT. Os **dados** não são nossos: cada conjunto mantém a licença da fonte oficial, e quem redistribuir deve manter a atribuição.

| Fonte | Licença | Atribuição | Observação |
|---|---|---|---|
| IBGE | Dados públicos (Lei 12.527/2011, Decreto 8.777/2016) — [termos](https://www.ibge.gov.br/acesso-informacao/institucional/termos-de-uso.html) | "Fonte: IBGE" | |
| ANEEL | Open Database License (ODbL) | "Fonte: ANEEL — Dados Abertos (ODbL)" | ODbL é *share-alike*: base derivada redistribuída fica ODbL |
| ONS | Creative Commons Atribuição | "Fonte: ONS — Dados Abertos (CC-BY)" | |
| SINISA (Ministério das Cidades) | Dados públicos (LAI, Decreto 8.777/2016). **Atenção:** o portal gov.br indica [CC BY-ND 3.0](https://creativecommons.org/licenses/by-nd/3.0/deed.pt_BR) para seu conteúdo e não há termo específico para as planilhas | "Fonte: SINISA / Ministério das Cidades" | ⚠️ validar juridicamente antes de redistribuir a base; valores mantidos exatamente como publicados |
| ANA / SNIRH | "É permitida a reprodução de dados e de informações, desde que citada a fonte" | "Fonte: ANA / SNIRH" | |
| ANA / Hidroweb | Mesmo termo da ANA (reprodução permitida citando a fonte) | "Fonte: ANA / Hidroweb" | O serviço exige cadastro gratuito; a credencial é de quem coleta e não é redistribuída |
| SGB / CPRM | Dado público federal; **não há termo de licença específico** para a setorização de risco (o repositório RIGEO diz "todos os direitos reservados, salvo indicação"; notícias do órgão permitem reprodução citando a fonte) | "Fonte: SGB/CPRM — Setorização de Áreas de Risco Geológico" | ⚠️ confirmar com o SGB antes de redistribuir a base |

A API devolve em toda resposta `proveniencia.licenca`, `proveniencia.atribuicao` e `proveniencia.url_origem`.

## Tratamentos aplicados

Fazemos só o necessário para os dados serem consultáveis; nada é recalculado.

- **ANEEL DEC/FEC e SAMP:** os arquivos publicados repetem cada linha; as repetições exatas são removidas. DEC/FEC passa de formato longo (um indicador por linha) para uma coluna por indicador. CNPJ recebe os zeros à esquerda.
- **ANEEL limites:** uma linha por distribuidora, conjunto e ano, com DEC e FEC lado a lado.
- **ANEEL conjuntos × municípios:** convertido de Latin-1 para UTF-8.
- **ONS carga:** registros sem valor são descartados (contagem na proveniência).
- **SINISA:** planilhas convertidas de uma coluna por indicador para uma linha por indicador; valores e textos de "Não calculado" mantidos como publicados; repetições idênticas do mesmo município removidas.
- **ANA estações:** o código de município da base HIDRO é próprio; `codigo_ibge` = município registrado (UF + nome), com a coordenada como reserva; `codigo_ibge_coordenada` = polígono da malha IBGE que contém o ponto (calculado). Campos Sim/Não viram verdadeiro/falso.
- **ANA Hidroweb (séries):** a API entrega um registro por mês com 31 colunas de dia; viramos um registro por dia, sem os dias que não existem no mês e sem dias vazios. Nas cotas, o dado bruto vem também com as leituras das 7 h e das 17 h; guardamos só a média diária (a mesma grandeza do consistido). Bruto e consistido ficam lado a lado (`nivel_consistencia`). `status` e `tipo_medicao` são repassados como códigos, sem tradução (a API não publica a tabela). Telemetria: horário como texto, sem fuso (a API não informa); alguns pluviômetros voltam sob o código da fluviométrica do mesmo posto, e guardamos o código que a ANA devolveu.
- **IBGE malha:** polígonos convertidos para GeoJSON, sem alteração.
- **SGB setores:** tipologias 1–5 unidas num campo; `latitude`/`longitude` = centróide calculado do polígono (marcado como calculado).

Cada tratamento e sua contagem ficam em `proveniencia.observacao`.
