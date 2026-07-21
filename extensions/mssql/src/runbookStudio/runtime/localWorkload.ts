/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from "crypto";

export const MAX_LOCAL_WORKLOAD_BYTES = 1024 * 1024;
export const MAX_LOCAL_WORKLOAD_BATCHES = 256;
export const MAX_LOCAL_WORKLOAD_GO_REPETITION = 100;

const BLOCKED_WORKLOAD_POLICY =
    /\b(?:use\s+|backup\s+(?:database|log)|restore\s+(?:database|log)|(?:create|alter|drop)\s+database|alter\s+server|(?:create|alter|drop)\s+server\s+role|shutdown\b|kill\s+\d+|dbcc\b|reconfigure\b|sp_configure\b|xp_[a-z0-9_]*\b|create\s+(?:login|credential|external\s+(?:data\s+source|file\s+format|table|library))|alter\s+login|drop\s+login|execute\s+as\s+login|openrowset\b|opendatasource\b|bulk\s+insert)\b/i;
const CROSS_DATABASE_REFERENCE =
    /(?:\b[A-Za-z_][A-Za-z0-9_$#@]*\b|\[[^\]\r\n]+\])\s*\.\s*(?:\b[A-Za-z_][A-Za-z0-9_$#@]*\b|\[[^\]\r\n]+\])\s*\./;
const MUTATION_SIGNAL =
    /\b(?:insert|update|delete|merge|create|alter|drop|truncate|grant|deny|revoke|execute|exec)\b/i;

export interface LocalWorkloadPlan {
    workloadSha256: string;
    sourceByteCount: number;
    batchCount: number;
    mutating: boolean;
    batches: string[];
}

export class LocalWorkloadPolicyError extends Error {
    constructor(
        public readonly reason:
            | "empty"
            | "tooLarge"
            | "unsupportedDirective"
            | "unresolvedVariable"
            | "unsafeStatement"
            | "tooManyBatches"
            | "invalidGoRepetition",
    ) {
        super(`Local workload policy rejected the script: ${reason}`);
        this.name = "LocalWorkloadPolicyError";
    }
}

export function parseLocalWorkload(content: Buffer | string): LocalWorkloadPlan {
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    if (bytes.length === 0) {
        throw new LocalWorkloadPolicyError("empty");
    }
    if (bytes.length > MAX_LOCAL_WORKLOAD_BYTES) {
        throw new LocalWorkloadPolicyError("tooLarge");
    }
    const text = bytes.toString("utf8").replace(/^\uFEFF/, "");
    if (text.includes("\0")) {
        throw new LocalWorkloadPolicyError("unsafeStatement");
    }
    const variables = new Map<string, string>();
    const sqlLines: string[] = [];
    for (const line of text.split(/\r?\n/)) {
        const setVariable = /^\s*:setvar\s+([A-Za-z_][A-Za-z0-9_]*)\s+(.+?)\s*$/i.exec(line);
        if (setVariable) {
            const rawValue = setVariable[2].trim();
            variables.set(
                setVariable[1].toLowerCase(),
                rawValue.startsWith('"') && rawValue.endsWith('"')
                    ? rawValue.slice(1, -1).replace(/""/g, '"')
                    : rawValue,
            );
            continue;
        }
        if (
            /^\s*:(?:r|on\s+error|connect|list|reset|error|out|perftrace)\b/i.test(line) ||
            /^\s*!!/.test(line)
        ) {
            throw new LocalWorkloadPolicyError("unsupportedDirective");
        }
        sqlLines.push(line);
    }

    const batches: string[] = [];
    let pending: string[] = [];
    const appendPending = (repetitions: number) => {
        const rawBatch = pending.join("\n").trim();
        pending = [];
        if (!rawBatch) {
            return;
        }
        const batch = rawBatch.replace(/\$\(([A-Za-z_][A-Za-z0-9_]*)\)/g, (_match, name) => {
            const value = variables.get(String(name).toLowerCase());
            if (value === undefined) {
                throw new LocalWorkloadPolicyError("unresolvedVariable");
            }
            return value;
        });
        const policyText = maskSqlStringsAndComments(batch);
        if (BLOCKED_WORKLOAD_POLICY.test(policyText) || CROSS_DATABASE_REFERENCE.test(policyText)) {
            throw new LocalWorkloadPolicyError("unsafeStatement");
        }
        if (batches.length + repetitions > MAX_LOCAL_WORKLOAD_BATCHES) {
            throw new LocalWorkloadPolicyError("tooManyBatches");
        }
        for (let repetition = 0; repetition < repetitions; repetition++) {
            batches.push(batch);
        }
    };

    for (const line of sqlLines) {
        const go = /^\s*GO(?:\s+(\d+))?\s*(?:--.*)?$/i.exec(line);
        if (!go) {
            pending.push(line);
            continue;
        }
        const repetitions = go[1] ? Number.parseInt(go[1], 10) : 1;
        if (
            !Number.isSafeInteger(repetitions) ||
            repetitions < 1 ||
            repetitions > MAX_LOCAL_WORKLOAD_GO_REPETITION
        ) {
            throw new LocalWorkloadPolicyError("invalidGoRepetition");
        }
        appendPending(repetitions);
    }
    appendPending(1);
    if (batches.length === 0) {
        throw new LocalWorkloadPolicyError("empty");
    }
    return {
        workloadSha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        sourceByteCount: bytes.length,
        batchCount: batches.length,
        mutating: batches.some((batch) => MUTATION_SIGNAL.test(maskSqlStringsAndComments(batch))),
        batches,
    };
}

/** Retains token boundaries while removing quoted/comment text so policy
 * keywords inside data or comments do not become false positives. */
function maskSqlStringsAndComments(sql: string): string {
    let result = "";
    let index = 0;
    let state: "code" | "string" | "lineComment" | "blockComment" = "code";
    while (index < sql.length) {
        const current = sql[index];
        const next = sql[index + 1];
        if (state === "code") {
            if (current === "'") {
                state = "string";
                result += " ";
            } else if (current === "-" && next === "-") {
                state = "lineComment";
                result += "  ";
                index++;
            } else if (current === "/" && next === "*") {
                state = "blockComment";
                result += "  ";
                index++;
            } else {
                result += current;
            }
        } else if (state === "string") {
            result += current === "\n" ? "\n" : " ";
            if (current === "'" && next === "'") {
                result += " ";
                index++;
            } else if (current === "'") {
                state = "code";
            }
        } else if (state === "lineComment") {
            result += current === "\n" ? "\n" : " ";
            if (current === "\n") {
                state = "code";
            }
        } else {
            result += current === "\n" ? "\n" : " ";
            if (current === "*" && next === "/") {
                result += " ";
                index++;
                state = "code";
            }
        }
        index++;
    }
    return result;
}
