#!/usr/bin/env bash
# Exemplos com curl. Suba antes: npm start
H=${H:-http://localhost:3010}

# o que existe
curl -s "$H/domains"

# achar conjuntos por conceito
curl -s "$H/search?q=popula%C3%A7%C3%A3o"

# municípios de SC com 100 mil+ habitantes
curl -s -X POST "$H/query" -H 'content-type: application/json' -d '{
  "conjunto": "territorio.municipios",
  "campos": ["codigo_ibge", "nome", "populacao_2022"],
  "filtros": { "uf": "SC", "populacao_2022": { "op": "gte", "valor": 100000 } },
  "ordenar": [{ "campo": "populacao_2022", "direcao": "desc" }]
}'
