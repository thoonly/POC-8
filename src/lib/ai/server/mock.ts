/**
 * AI_MOCK=1: answer every call without a key or cost, so UI states can be checked.
 * Calls with a schema get a value generated from the schema. Calls with a registered label get
 * that fixture. Everything else gets a short placeholder. Register fixtures next to the feature
 * that owns the label: registerMock("entry:graph", () => ({ ... })).
 */
import type { CompleteRequest, JsonSchema } from "../types";

type Fixture = (req: CompleteRequest) => unknown;
const fixtures = new Map<string, Fixture>();

export function registerMock(labelPrefix: string, fixture: Fixture): void {
  fixtures.set(labelPrefix, fixture);
}

export function fromSchema(schema: JsonSchema | undefined, depth = 0): unknown {
  if (!schema || typeof schema !== "object" || depth > 6) return null;
  const s = schema as Record<string, any>;
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  const type = Array.isArray(s.type) ? s.type.find((t: string) => t !== "null") : s.type;
  switch (type) {
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries<JsonSchema>(s.properties || {})) out[k] = fromSchema(v, depth + 1);
      return out;
    }
    case "array": {
      const n = Math.min(Math.max(Number(s.minItems) || 2, 1), Number(s.maxItems) || 2);
      return Array.from({ length: n }, () => fromSchema(s.items, depth + 1));
    }
    case "integer": case "number": return Number(s.minimum) || 0;
    case "boolean": return false;
    default: return "Mock text";
  }
}

export function mockAnswer(req: CompleteRequest): string {
  for (const [prefix, fx] of fixtures) {
    if (req.label.startsWith(prefix)) {
      const v = fx(req);
      return typeof v === "string" ? v : JSON.stringify(v);
    }
  }
  if (req.schema) return JSON.stringify(fromSchema(req.schema));
  if (req.json) return "{}";
  return `Mock answer for ${req.label}.`;
}
