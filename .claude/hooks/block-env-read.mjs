// PreToolUse (Bash / PowerShell): bloquea comandos de shell que mencionen archivos .env.
// Permite .env.example. Es defensa en profundidad: las reglas deny de settings.json solo cubren
// las herramientas de archivos (Read/Edit), no lo que un comando de shell lee por su cuenta.
import { readFileSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8") || "{}");
const command = String(input?.tool_input?.command ?? "");

// ".env" como nombre de archivo: precedido por inicio, espacio, comilla, separador de ruta, = : ( < , ;
// (así "process.env" o "$env:Path" no cuentan) y seguido opcionalmente de sufijos (.local, .production…).
const pattern = /(?:^|[\s"'`=:(<,;\\/])(\.env[\w.*-]*)/gi;
const hits = [...command.matchAll(pattern)]
  .map((m) => m[1].toLowerCase())
  .filter((name) => !/^\.env\.example$/.test(name));

if (hits.length > 0) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          `Bloqueado por .claude/hooks/block-env-read.mjs: el comando referencia ${[...new Set(hits)].join(", ")}. ` +
          "Los archivos .env contienen secretos; usá .env.example como referencia.",
      },
    }),
  );
}
process.exit(0);
