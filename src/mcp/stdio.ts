/** MCP por stdio — para Claude Desktop, Claude Code, Cursor etc. */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Banco } from "../banco/db.ts";
import { criarServidorMcp } from "./servidor.ts";

const banco = await Banco.abrir(undefined, { somenteLeitura: true });
await criarServidorMcp(banco).connect(new StdioServerTransport());
