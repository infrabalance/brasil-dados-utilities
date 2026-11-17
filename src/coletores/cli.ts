import { copyFileSync, existsSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Banco, caminhoBanco } from "../banco/db.ts";
import { acharConjunto } from "../dominios/catalogo.ts";
import { falhou, verificarConjunto, type Verificacao } from "../qualidade/verificar.ts";
import { coletorAna } from "./ana.ts";
import { coletorAneel } from "./aneel.ts";
import { coletorUsinas } from "./aneelUsinas.ts";
import { coletorHidroweb } from "./hidroweb.ts";
import { iniciarRegistro, lerRegistro } from "./http.ts";
import { coletorIbge } from "./ibge.ts";
import { coletorOns } from "./ons.ts";
import { coletorSgb } from "./sgb.ts";
import { coletorSinisa } from "./sinisa.ts";
import type { Coletor } from "./tipos.ts";

// credenciais opcionais (ex.: Hidroweb) ficam no .env da raiz do projeto, fora do git
try {
  process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
} catch {
  // sem .env: só os coletores que não exigem credencial rodam
}

// IBGE primeiro: os outros conferem códigos e cruzam com a malha municipal
// Hidroweb depois do inventário da ANA (usa agua_estacoes para nome e município)
export const COLETORES: Coletor[] = [coletorIbge, coletorSgb, coletorAneel, coletorUsinas, coletorOns, coletorSinisa, coletorAna, coletorHidroweb];

const args = process.argv.slice(2);
const forcar = args.includes("--forcar");
const alvo = args.find((a) => !a.startsWith("--")) ?? "todos";
const porId = COLETORES.filter((c) => c.id === alvo);
const escolhidos = alvo === "todos" ? COLETORES : porId.length ? porId : COLETORES.filter((c) => c.dominio === alvo);

if (escolhidos.length === 0) {
  const opcoes = [...new Set(COLETORES.flatMap((c) => [c.dominio, ...(c.id ? [c.id] : [])]))];
  console.error(`Domínio desconhecido: ${alvo}. Opções: todos, ${opcoes.join(", ")}`);
  process.exit(1);
}

// --copia: coleta numa cópia e troca o arquivo no fim, com o servidor no ar
// (o DuckDB não deixa um processo escrever enquanto outro lê o mesmo arquivo)
const copia = args.includes("--copia");
const principal = caminhoBanco();
const destino = copia ? `${principal}.novo` : principal;
if (copia) {
  // uma coleta por vez (todas usam a mesma cópia); trava velha (>6 h) é de coleta que morreu
  const trava = `${principal}.trava`;
  try {
    if (Date.now() - statSync(trava).mtimeMs < 6 * 3600_000) {
      console.error("Outra coleta está em andamento; tente depois.");
      process.exit(2);
    }
  } catch { /* sem trava */ }
  writeFileSync(trava, String(process.pid));
  process.on("exit", () => rmSync(trava, { force: true }));
  for (const x of [destino, `${destino}.wal`]) rmSync(x, { force: true });
  // o .wal guarda escritas ainda não consolidadas: copia junto, senão elas se perdem
  if (existsSync(principal)) copyFileSync(principal, destino);
  if (existsSync(`${principal}.wal`)) copyFileSync(`${principal}.wal`, `${destino}.wal`);
}
const banco = await Banco.abrir(destino);
// extensões oficiais do DuckDB, instaladas fora das transações
await banco.exec("install spatial; load spatial; install excel; load excel;");
let falhas = 0;

for (const c of escolhidos) {
  const motivo = c.indisponivel?.();
  if (motivo) {
    if (porId.includes(c)) {
      console.error(`✗ ${c.id}: ${motivo}`);
      falhas++;
    } else {
      console.log(`- ${c.id ?? c.dominio} pulado: ${motivo}`);
    }
    continue;
  }
  const t0 = Date.now();
  // coleta anterior, para comparar o tamanho
  const anteriores = new Map(
    (await banco.consultar<{ conjunto: string; linhas: number }>("select conjunto, linhas from _proveniencia"))
      .map((p) => [p.conjunto, Number(p.linhas)]),
  );
  iniciarRegistro();
  // tudo numa transação: se a coleta ou um portão de qualidade falhar, nada muda no banco
  await banco.exec("begin transaction");
  try {
    await c.coletar(banco, (m) => console.log(m));
    const arquivos = JSON.stringify(lerRegistro());
    const reprovados: string[] = [];
    for (const id of c.conjuntos) {
      const conj = acharConjunto(id);
      if (!conj) throw new Error(`conjunto ${id} não está no catálogo`);
      const verificacoes: Verificacao[] = await verificarConjunto(banco, conj, {
        linhasAnteriores: forcar ? undefined : anteriores.get(id),
      });
      for (const v of verificacoes) {
        console.log(`  ${v.ok ? "✓" : falhou(v) ? "✗" : "!"} ${id} · ${v.nome}: ${v.detalhe}`);
        if (falhou(v)) reprovados.push(`${id} · ${v.nome}`);
      }
      await banco.exec("update _proveniencia set arquivos = ?, verificacoes = ? where conjunto = ?", [
        arquivos,
        JSON.stringify({ aprovado: true, em: new Date().toISOString(), forcado: forcar, itens: verificacoes }),
        id,
      ]);
    }
    if (reprovados.length) {
      throw new Error(
        `reprovado nos portões de qualidade (${reprovados.join("; ")}). Mantida a versão anterior.` +
          (reprovados.some((r) => r.endsWith("sem_queda_brusca")) ? " Se a queda for legítima, rode de novo com --forcar." : ""),
      );
    }
    await banco.exec("commit");
    console.log(`✓ ${c.id ?? c.dominio} em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  } catch (e) {
    await banco.exec("rollback").catch(() => {});
    falhas++;
    console.error(`✗ ${c.id ?? c.dominio}: ${e instanceof Error ? e.message : e}`);
  }
}
// consolida o .wal no arquivo principal antes de sair (process.exit não fecha o banco)
await banco.exec("checkpoint");
if (copia) {
  banco.fechar();
  rmSync(`${destino}.wal`, { force: true });
  // falhas de um coletor já voltaram atrás (rollback); o que passou nos portões entra
  if (falhas < escolhidos.length) {
    // primeiro some o .wal da base antiga (já consolidado na cópia), para nunca ser
    // reaplicado sobre a base nova; depois a troca atômica
    rmSync(`${principal}.wal`, { force: true });
    renameSync(destino, principal); // o servidor no ar troca de base sozinho
    console.log("Base trocada; o servidor no ar recarrega em até 30 s.");
  } else {
    rmSync(destino, { force: true });
    console.log("Nenhuma coleta aprovada; base no ar mantida.");
  }
}
process.exit(falhas ? 1 : 0);
