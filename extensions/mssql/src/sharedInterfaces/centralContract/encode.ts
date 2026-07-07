/* GENERATED — do not edit. Source of truth: perftest/packages/perf-contracts/src/central/.
 * Re-vendor: copy the src/central/*.ts files here with this header (see
 * perf-contracts test/centralVendorSync.test.ts, which pins byte equality).
 * Contract central/1.0 — one projection implementation, two writers. */
/**
 * SQL literal encoding for the product writer (review addendum C-11).
 *
 * The extension's SQL Data Plane executes text only — no parameter binding —
 * so OPENJSON inputs ride as N-string literals. This encoder is the single
 * audited path for that: it doubles quotes, refuses control characters that
 * the projection layer should have sanitized away, and enforces a per-execute
 * text budget. The CLI writer uses real parameters instead (tedious); test
 * T-B6 pins both call styles to identical stored rows so this encoder cannot
 * diverge silently.
 */

const NUL = String.fromCharCode(0);

/** Default per-execute batch text budget (addendum C-11: ~1.5 MB). */
export const DEFAULT_MAX_ITEM_BYTES = 1_572_864;

export class SqlEncodeError extends Error {
  constructor(
    message: string,
    public readonly code: "nulByte" | "unpairedSurrogate" | "budgetExceeded" | "nonFinite",
  ) {
    super(message);
    this.name = "SqlEncodeError";
  }
}

/** True when `value` contains an unpaired UTF-16 surrogate code unit. */
export function hasUnpairedSurrogate(value: string): boolean {
  // isWellFormed is available on Node >= 20; keep a manual fallback so the
  // vendored copy stays portable.
  const wf = (value as { isWellFormed?: () => boolean }).isWellFormed;
  if (typeof wf === "function") {
    return !wf.call(value);
  }
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/**
 * Sanitize a string bound for a payload value: strips NUL and replaces
 * unpaired surrogates with U+FFFD. Returns the sanitized string and whether
 * anything changed (the projection counts a change as handling "truncated").
 */
export function sanitizePayloadString(value: string): { value: string; changed: boolean } {
  let changed = false;
  let out = value;
  if (out.includes(NUL)) {
    out = out.split(NUL).join("");
    changed = true;
  }
  if (hasUnpairedSurrogate(out)) {
    // toWellFormed on Node >= 20; manual scan fallback mirrors hasUnpairedSurrogate.
    const twf = (out as { toWellFormed?: () => string }).toWellFormed;
    if (typeof twf === "function") {
      out = twf.call(out);
    } else {
      let repaired = "";
      for (let i = 0; i < out.length; i++) {
        const code = out.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff) {
          const next = out.charCodeAt(i + 1);
          if (next >= 0xdc00 && next <= 0xdfff) {
            repaired += out[i]! + out[i + 1]!;
            i++;
          } else {
            repaired += "�";
          }
        } else if (code >= 0xdc00 && code <= 0xdfff) {
          repaired += "�";
        } else {
          repaired += out[i]!;
        }
      }
      out = repaired;
    }
    changed = true;
  }
  return { value: out, changed };
}

/**
 * Encode a string as an N'...' SQL literal. Throws (never repairs) on NUL or
 * unpaired surrogates — sanitization is the projection layer's job, and a
 * value reaching this point unsanitized is a bug, not data.
 */
export function sqlNString(value: string, maxBytes: number = DEFAULT_MAX_ITEM_BYTES): string {
  if (value.includes(NUL)) {
    throw new SqlEncodeError("sqlNString: NUL byte in value (projection must sanitize)", "nulByte");
  }
  if (hasUnpairedSurrogate(value)) {
    throw new SqlEncodeError(
      "sqlNString: unpaired surrogate in value (projection must sanitize)",
      "unpairedSurrogate",
    );
  }
  const literal = `N'${value.split("'").join("''")}'`;
  // Budget is enforced on the literal's UTF-8 byte length: a conservative,
  // deterministic proxy for the wire cost of the execute text.
  const bytes = Buffer.byteLength(literal, "utf8");
  if (bytes > maxBytes) {
    throw new SqlEncodeError(
      `sqlNString: literal is ${bytes} bytes, over the ${maxBytes}-byte budget — chunk the item smaller`,
      "budgetExceeded",
    );
  }
  return literal;
}

/** Encode a value for a SQL literal position: numbers/booleans/null/string. */
export function sqlLiteral(value: string | number | boolean | null): string {
  if (value === null) {
    return "NULL";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new SqlEncodeError(`sqlLiteral: non-finite number ${value}`, "nonFinite");
    }
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }
  return sqlNString(value);
}
