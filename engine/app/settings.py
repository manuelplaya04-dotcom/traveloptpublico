from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

Mode = Literal["fixture", "hybrid", "live"]
# n8n: el webhook dispara el flujo (local y entornos con n8n). inprocess: el motor orquesta solo (producción sin
# n8n, decisión del 2026-11-01 para operar sin costo; ver project_guidelines.md).
Orchestrator = Literal["n8n", "inprocess"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    env: Literal["local", "staging", "production"] = "production"  # falla cerrado: sin ENV explícito no hay rutas dev
    engine_api_key: str = Field(min_length=24)
    database_url: str | None = None  # sin DB -> repositorio en memoria (solo local/tests)
    default_mode: Mode = "fixture"
    n8n_webhook_url: str | None = None  # p.ej. http://localhost:5678/webhook/plan-trip
    n8n_webhook_secret: str | None = None
    openweather_api_key: str | None = None
    serpapi_api_key: str | None = None  # vuelos reales (modos hybrid y live); sin clave, hybrid sigue con vuelos de ejemplo
    max_flight_queries_per_run: int = Field(12, ge=1)  # cuota gratuita de SerpApi: 250 búsquedas/mes
    max_lodging_queries_per_run: int = Field(8, ge=1)  # misma cuota; hoteles (+ alquileres si el grupo es de 3 o más)
    max_serpapi_queries_per_run: int = Field(6, ge=1)  # presupuesto pago por corrida; si no entra, se recorta el plan
    alert_webhook_url: SecretStr | None = None  # Discord/Slack/Telegram; secreto (la URL misma es la credencial)
    ticketmaster_api_key: str | None = None  # eventos (Discovery API, gratis sin tarjeta); sin clave, solo Google Events
    # ciudades cuyo Google Events pre-carga el cron semanal (una búsqueda de SerpApi por ciudad): "CODIGO:Nombre,..."
    prefetch_event_cities: str = "ORL:Orlando,NYC:New York"
    serpapi_quota_reserve: int = Field(20, ge=0)  # búsquedas que se dejan sin usar; al llegar, modo histórico
    http_timeout_s: float = 20.0
    noncritical_deadline_s: float = 4.0  # clima y actividades: pasado este plazo, la corrida sigue sin ellos
    stale_run_seconds: int = 600
    orchestrator: Orchestrator = "n8n"
    retention_days: int = 30  # las búsquedas se borran solas (privacidad: el sitio no guarda datos indefinidamente)
    reap_interval_s: int = 300  # solo inprocess: cada cuánto se marcan como fallidas las corridas colgadas
    max_concurrent_optimizations: int = 2  # solo inprocess: tope de CP-SAT simultáneos (instancia de 512 MB)
    max_active_runs_per_user: int = 2
    max_runs_per_user_hour: int = 10
    max_active_runs_total: int = 20  # tope global: cada sesión anónima es un user_id nuevo
    max_weather_requests_per_user_hour: int = 30
    max_client_errors_per_user_hour: int = 20  # reportes de errores del navegador (no deben poder inundar la base)  # "Ver más" del clima (ya cacheado por ciudad)

    @property
    def is_dev(self) -> bool:
        return self.env != "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
