FROM python:3.12.15-slim
# Versiones fijas (= local): builds reproducibles y sin sorpresas de la cadena de suministro.
COPY --from=ghcr.io/astral-sh/uv:0.13.5 /uv /uvx /bin/

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY app ./app
COPY fixtures ./fixtures
RUN uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:$PATH" ENV=production
RUN useradd --create-home appuser
USER appuser
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.api.main:app --host ${HOST:-0.0.0.0} --port ${PORT:-8000} --proxy-headers"]
