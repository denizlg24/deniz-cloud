import type { Document } from "mongodb";
import type { FieldMapping } from "../db/schema";

export function transformDocument(doc: Document, mapping: FieldMapping): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  const idField = mapping.primaryKey ?? "_id";
  const rawId = doc[idField] ?? doc._id;
  result.id = rawId?.toString?.() ?? String(rawId);

  const entries = Object.entries(doc);

  for (const [key, value] of entries) {
    if (key === "_id") continue;

    if (mapping.includeFields && mapping.includeFields.length > 0) {
      if (!mapping.includeFields.includes(key)) continue;
    }

    if (mapping.excludeFields?.includes(key)) continue;

    result[key] = coerceValue(value);
  }

  return result;
}

function coerceValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) return Math.floor(value.getTime() / 1000);

  if (
    typeof value === "object" &&
    "toHexString" in value &&
    typeof value.toHexString === "function"
  ) {
    return value.toHexString();
  }

  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return undefined;

  if (Array.isArray(value)) return value.map(coerceValue);

  if (typeof value === "object" && value !== null) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const coerced = coerceValue(v);
      if (coerced !== undefined) obj[k] = coerced;
    }
    return obj;
  }

  return value;
}
