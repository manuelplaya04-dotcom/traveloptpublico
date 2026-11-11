"""Gate de fase: corre los checks automáticos de una fase e imprime OK/FAIL.

    uv run python scripts/gate.py 1

Los checks MANUALES de cada fase están en su documento (fase_N_*.md) y se tildan a mano.
"""
from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
F1_TESTS = ["tests/test_money.py", "tests/test_query_plan.py", "tests/test_fixture_contracts.py",
            "tests/test_weather_and_http.py", "tests/test_api_extraction.py"]


def no_secrets_in_bundle() -> tuple[bool, str]:
    """Ningún valor de variable server-only de web/.env.local aparece en el bundle del cliente."""
    env, static = ROOT / "web" / ".env.local", ROOT / "web" / ".next" / "static"
    if not env.exists() or not static.exists():
        return False, "falta web/.env.local o web/.next (correr npm run build)"
    secrets = [
        v.strip() for k, _, v in (ln.partition("=") for ln in env.read_text(encoding="utf-8").splitlines())
        if k and not k.startswith(("#", "NEXT_PUBLIC_")) and len(v.strip()) >= 16
        and not v.strip().startswith(("http://", "https://"))  # URLs (ENGINE_BASE_URL) no son secretos
    ]
    # Una secret key real, no el prefijo suelto: supabase-js trae `startsWith("sb_secret_")` en su código.
    secret_key = re.compile(r"sb_secret_[A-Za-z0-9_-]{16,}")
    for f in static.rglob("*.js"):
        text = f.read_text(encoding="utf-8", errors="ignore")
        if any(s in text for s in secrets) or secret_key.search(text):
            return False, f"secreto encontrado en {f.relative_to(ROOT)}"
    return True, f"{len(secrets)} secretos verificados"


def workflows_exported() -> tuple[bool, str]:
    names = {p.name for p in (ROOT / "n8n" / "workflows").glob("*.json")}
    need = {"wf01_plan_trip.json", "wf02_error_handler.json", "wf03_maintenance.json"}
    return need <= names, f"presentes: {sorted(names)}"


CHECKS: dict[int, list] = {
    0: [
        ("uv", ["uv", "--version"], "."),
        ("docker engine", ["docker", "info", "--format", "{{.ServerVersion}}"], "."),
        ("supabase local", ["npx", "supabase", "status"], "."),
        ("n8n local", ["docker", "compose", "ps", "--status", "running", "n8n"], "."),
        ("devtools MCP importa", ["uv", "run", "--project", "tools/devtools_mcp", "python", "-c",
                                  "import sys; sys.path.insert(0, 'tools/devtools_mcp'); import server"], "."),
    ],
    1: [
        ("pytest fase 1", ["uv", "run", "pytest", "-q", *F1_TESTS], "engine"),
        ("ruff", ["uv", "run", "ruff", "check", "."], "engine"),
        ("pgTAP RLS", ["npx", "supabase", "test", "db"], "."),
    ],
    2: [
        ("pytest fase 1 (regresión)", ["uv", "run", "pytest", "-q", *F1_TESTS], "engine"),
        ("workflows exportados", workflows_exported, "."),
    ],
    3: [
        ("pytest completo", ["uv", "run", "pytest", "-q"], "engine"),
        ("CLI caso fixture", ["uv", "run", "python", "-m", "app.cli", "orlando_nyc_5pax"], "engine"),
        ("ruff", ["uv", "run", "ruff", "check", "."], "engine"),
        ("mypy", ["uv", "run", "mypy"], "engine"),
    ],
    4: [
        ("lint", ["npm", "run", "lint"], "web"),
        ("typecheck", ["npm", "run", "typecheck"], "web"),
        ("unit (vitest)", ["npm", "run", "test"], "web"),
        ("build", ["npm", "run", "build"], "web"),
        ("sin secretos en bundle", no_secrets_in_bundle, "."),
        ("e2e (playwright)", ["npx", "playwright", "test"], "web"),
    ],
    5: [
        ("pytest completo", ["uv", "run", "pytest", "-q"], "engine"),
        ("build web", ["npm", "run", "build"], "web"),
        ("sin secretos en bundle", no_secrets_in_bundle, "."),
    ],
}


def run(check) -> tuple[bool, str]:
    name, cmd, cwd = check
    if callable(cmd):
        return cmd()
    exe = shutil.which(cmd[0])  # en Windows resuelve npx.cmd / uv.exe
    if exe is None:
        return False, f"no se encontró '{cmd[0]}' en PATH"
    p = subprocess.run([exe, *cmd[1:]], cwd=ROOT / cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    tail = (p.stdout + p.stderr).strip().splitlines()[-1:] or [""]
    return p.returncode == 0, tail[0][:120]


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")  # consola de Windows
    phase = int(sys.argv[1])
    ok_all = True
    for check in CHECKS[phase]:
        ok, detail = run(check)
        ok_all &= ok
        print(f"[{'OK ' if ok else 'FAIL'}] {check[0]:<28} {detail}")
    print(f"\nGATE FASE {phase}: {'OK' if ok_all else 'FAIL'}  (completar además los checks manuales del documento)")
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
