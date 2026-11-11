// Respuesta de /api/explanation. Cualquier otra forma se descarta: la explicación es un extra y nunca rompe la vista.
export type Explanation = { text: string; source: "ai" | "rules" };

const MAX_CHARS = 900; // mismo tope que el control de integridad del motor

export function parseExplanation(body: unknown): Explanation | null {
  if (!body || typeof body !== "object") return null;
  const { text, source } = body as { text?: unknown; source?: unknown };
  if (typeof text !== "string" || !text.trim() || text.length > MAX_CHARS) return null;
  if (source !== "ai" && source !== "rules") return null;
  return { text: text.trim(), source };
}
