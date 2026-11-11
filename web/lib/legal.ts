// Datos de la página legal. Decisión del 2026-11-01: herramienta gratuita y demostrativa, sin datos personales del
// responsable publicados. Si el proyecto pasa a ser comercial, completar `entity` y `contactEmail` y revisar el texto
// con un abogado. Mientras sean null, la página no muestra datos inventados.
export const LEGAL = {
  siteName: "TravelOpt",
  entity: null as string | null, // razón social o titular responsable
  contactEmail: null as string | null, // email del proyecto (nunca el de administración)
  jurisdiction: "República Argentina",
  retentionDays: 30, // igual a RETENTION_DAYS del motor (engine/app/settings.py)
  updatedAt: "2026-11-01",
};
