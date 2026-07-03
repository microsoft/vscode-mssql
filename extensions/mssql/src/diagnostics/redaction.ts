/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Classification + redaction for the diagnostics substrate. Redaction happens
 * BEFORE an envelope is constructed: raw sensitive values never reach a sink,
 * the session store, or the webview.
 *
 * Hard rules (not settings):
 *  - secret / token / connection.string values are NEVER persisted as
 *    plaintext under any capture mode; at most an opaque token.
 *  - Unknown classifications are treated as sensitive (redacted).
 */

import { createHash, randomBytes } from "crypto";
import {
    CaptureMode,
    CapturePolicy,
    ClassifiedValue,
    DataClassification,
} from "../sharedInterfaces/debugConsole";

/** Per-process salt so digests are stable within a session but not rainbow-table bait. */
const SESSION_SALT = randomBytes(16).toString("hex");

export function digestValue(prefix: string, value: string): string {
    const hash = createHash("sha256").update(SESSION_SALT).update(value).digest("hex").slice(0, 16);
    return `${prefix}:sha256:${hash}`;
}

const NEVER_PLAIN: ReadonlySet<DataClassification> = new Set([
    "secret",
    "connection.string",
    "token",
]);

const DIGEST_PREFIX: Partial<Record<DataClassification, string>> = {
    "server.name": "srv",
    "database.name": "db",
    "schema.name": "schema",
    "object.name": "obj",
    "sql.text": "sql",
    "source.path": "uri",
    "row.data": "row",
    "user.text": "txt",
    "model.prompt": "prompt",
    "model.response": "resp",
};

/** Classifications that are safe to store as plain text in every mode. */
const ALWAYS_PLAIN: ReadonlySet<DataClassification> = new Set([
    "public",
    "system.metadata",
    "diagnostic.metadata",
    "sql.digest",
    "result.shape",
]);

function allowPlain(cls: DataClassification, policy: CapturePolicy): boolean {
    if (NEVER_PLAIN.has(cls)) {
        return false;
    }
    if (ALWAYS_PLAIN.has(cls)) {
        return true;
    }
    if (policy.mode !== "full") {
        return false;
    }
    switch (cls) {
        case "sql.text":
            return policy.allowSqlText;
        case "row.data":
            return policy.allowRowData;
        case "server.name":
        case "database.name":
        case "schema.name":
        case "object.name":
        case "source.path":
            return policy.allowConnectionDetails;
        case "user.text":
        case "model.prompt":
        case "model.response":
            return policy.allowSqlText;
        default:
            return false;
    }
}

const MAX_PLAIN_LENGTH = 4096;

/**
 * Apply the capture policy to one raw value. This is the single choke point —
 * every payload field passes through here.
 */
export function classify(
    raw: unknown,
    cls: DataClassification,
    policy: CapturePolicy,
): ClassifiedValue {
    // Non-sensitive primitives pass through untouched (numbers/booleans carry
    // no text payload risk for metadata classes).
    if (ALWAYS_PLAIN.has(cls)) {
        return { v: toPrimitive(raw), cls, handling: "plain" };
    }
    const text = raw === null || raw === undefined ? "" : String(raw);

    if (NEVER_PLAIN.has(cls)) {
        // Opaque token only — length concealed, not reversible, not a raw hash
        // of the secret alone (salted).
        return { cls, handling: "tokenized", digest: digestValue("tok", text) };
    }
    if (policy.mode === "off") {
        return { cls, handling: "omitted" };
    }
    if (allowPlain(cls, policy)) {
        if (text.length > MAX_PLAIN_LENGTH) {
            return {
                v: text.slice(0, MAX_PLAIN_LENGTH),
                cls,
                handling: "truncated",
                len: text.length,
            };
        }
        return { v: toPrimitive(raw), cls, handling: "plain" };
    }
    if (policy.mode === "digest" || policy.mode === "full") {
        return {
            cls,
            handling: "digest",
            digest: digestValue(DIGEST_PREFIX[cls] ?? "val", text),
            len: text.length,
        };
    }
    // redacted mode: names get digests (grouping stays possible), free text is
    // fully redacted.
    switch (cls) {
        case "server.name":
        case "database.name":
        case "schema.name":
        case "object.name":
        case "source.path":
            return {
                cls,
                handling: "digest",
                digest: digestValue(DIGEST_PREFIX[cls] ?? "val", text),
            };
        default:
            return { cls, handling: "redacted", len: text.length };
    }
}

function toPrimitive(raw: unknown): string | number | boolean | null {
    if (raw === null || raw === undefined) {
        return null;
    }
    if (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "string") {
        return raw;
    }
    return String(raw);
}

/** Build a classified payload from raw fields; returns payload + summary counts. */
export function classifyPayload(
    fields: Record<string, { raw: unknown; cls: DataClassification }>,
    policy: CapturePolicy,
): {
    payload: Record<string, ClassifiedValue>;
    maxClassification: DataClassification;
    redactedFields: number;
} {
    const payload: Record<string, ClassifiedValue> = {};
    let redacted = 0;
    let max: DataClassification = "public";
    for (const [key, field] of Object.entries(fields)) {
        const value = classify(field.raw, field.cls, policy);
        payload[key] = value;
        if (value.handling !== "plain") {
            redacted++;
        }
        if (rank(field.cls) > rank(max)) {
            max = field.cls;
        }
    }
    return { payload, maxClassification: max, redactedFields: redacted };
}

const RANK_ORDER: DataClassification[] = [
    "public",
    "system.metadata",
    "diagnostic.metadata",
    "result.shape",
    "sql.digest",
    "source.path",
    "object.name",
    "schema.name",
    "database.name",
    "server.name",
    "user.text",
    "sql.text",
    "row.data",
    "model.prompt",
    "model.response",
    "unknown",
    "token",
    "connection.string",
    "secret",
];

function rank(cls: DataClassification): number {
    const index = RANK_ORDER.indexOf(cls);
    return index < 0 ? RANK_ORDER.length : index;
}

export const CAPTURE_POLICIES: Record<Exclude<CaptureMode, "full">, CapturePolicy> & {
    full: (reason: string, expiresEpochMs: number) => CapturePolicy;
} = {
    off: {
        policyId: "policy_off",
        mode: "off",
        allowSqlText: false,
        allowRowData: false,
        allowConnectionDetails: false,
        allowSecrets: false,
    },
    redacted: {
        policyId: "policy_redacted_default",
        mode: "redacted",
        allowSqlText: false,
        allowRowData: false,
        allowConnectionDetails: false,
        allowSecrets: false,
    },
    digest: {
        policyId: "policy_digest",
        mode: "digest",
        allowSqlText: false,
        allowRowData: false,
        allowConnectionDetails: false,
        allowSecrets: false,
    },
    full: (reason: string, expiresEpochMs: number): CapturePolicy => ({
        policyId: "policy_full_elevated",
        mode: "full",
        allowSqlText: true,
        allowRowData: false,
        allowConnectionDetails: true,
        allowSecrets: false,
        expiresEpochMs,
        reason,
    }),
};
