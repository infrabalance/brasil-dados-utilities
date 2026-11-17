import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import { criarApp } from "./api/app.ts";
import { opcoesDoAmbiente } from "./api/protecoes.ts";
import { Banco } from "./banco/db.ts";

const porta = Number(process.env.PORT ?? 3010);
// padrão: só nesta máquina. Para publicar, HOST=0.0.0.0 e BDU_HOSTS=seu.dominio (veja docs/SEGURANCA.md)
const host = process.env.HOST ?? "127.0.0.1";
import { statSync } from "node:fs";
import { caminhoBanco } from "./banco/db.ts";

const banco = await Banco.abrir(undefined, { somenteLeitura: true });

// coleta sem tirar do ar: o coletor grava numa cópia e troca o arquivo no fim
// (rename atômico); aqui a troca é percebida pelo inode e a base é reaberta
const inodeAtual = () => { try { return statSync(caminhoBanco()).ino; } catch { return 0; } };
let inode = inodeAtual();
setInterval(async () => {
  const agora = inodeAtual();
  if (!agora || agora === inode) return;
  try {
    await banco.recarregar();
    inode = agora;
    console.log(`Base de dados recarregada (${new Date().toISOString()}).`);
  } catch (e) {
    console.error("Falha ao recarregar a base; segue a anterior:", e instanceof Error ? e.message : e);
  }
}, Number(process.env.BDU_VIGIA_MS ?? 30_000)).unref();
const protecao = opcoesDoAmbiente();

const servidor = serve({ fetch: criarApp(banco, protecao).fetch, port: porta, hostname: host }, (info) => {
  console.log(`Brasil Dados Utilities em http://${host === "0.0.0.0" ? "localhost" : host}:${info.port}  (MCP em /mcp)`);
  if (host !== "127.0.0.1" && host !== "localhost" && protecao.hostsPermitidos.length === 0) {
    console.warn("Aviso: servidor exposto sem BDU_HOSTS; defina o(s) domínio(s) públicos aceitos.");
  }
});
// conexões lentas não seguram o servidor (slowloris)
(servidor as Server).requestTimeout = 30_000;
(servidor as Server).headersTimeout = 10_000;
