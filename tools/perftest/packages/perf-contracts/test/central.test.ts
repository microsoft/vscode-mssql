import { describe, expect, it } from "vitest";

import {
    canonicalJson,
    clsRank,
    DEFAULT_MAX_ITEM_BYTES,
    digestCanonical,
    entityLockResource,
    hasUnpairedSurrogate,
    maxClassification,
    principalDigest,
    RANK_ORDER,
    RANK_TABLE_VERSION,
    sanitizePayloadString,
    sha256Hex,
    sqlLiteral,
    sqlNString,
    UPLOAD_POLICIES,
} from "../src";

const NUL = String.fromCharCode(0);

describe("central digest rules (design §6.2, addendum C-14/C-15)", () => {
    it("canonicalJson sorts keys at every level and is stable", () => {
        const a = canonicalJson({ b: 1, a: { d: [3, 1], c: null } });
        const b = canonicalJson({ a: { c: null, d: [3, 1] }, b: 1 });
        expect(a).toBe(b);
        expect(a).toBe('{"a":{"c":null,"d":[3,1]},"b":1}');
    });

    it("digestCanonical prefixes by kind and is deterministic", () => {
        const d1 = digestCanonical("source", { x: 1 });
        const d2 = digestCanonical("source", { x: 1 });
        const d3 = digestCanonical("content", { x: 1 });
        expect(d1).toBe(d2);
        expect(d1).toMatch(/^src_[A-Za-z0-9_-]{22}$/);
        expect(d3).toMatch(/^cnt_[A-Za-z0-9_-]{22}$/);
        expect(d1.slice(4)).toBe(d3.slice(4)); // same content, different tag
    });

    it("principalDigest normalizes per kind (C-14 recipe)", () => {
        const a = principalDigest({ kind: "domainUser", value: "  Karl.B@Contoso.com " });
        const b = principalDigest({ kind: "domainUser", value: "karl.b@contoso.com" });
        expect(a).toBe(b);
        expect(a).toMatch(/^prn_[A-Za-z0-9_-]{22}$/);
        expect(principalDigest({ kind: "alias", value: "karlb" })).not.toBe(a);
        expect(() => principalDigest({ kind: "ci" })).toThrow(/empty principal/);
        const ci = principalDigest({
            kind: "ci",
            pipelineIdentity: "nightly",
            poolName: "pinned-01",
        });
        expect(ci).toMatch(/^prn_/);
    });

    it("entityLockResource matches the T-SQL applock recipe", () => {
        const r = entityLockResource("perfRun", "run-1");
        expect(r).toBe(`central:perfRun:${sha256Hex("run-1")}`);
    });
});

describe("classification ladder (addendum Appendix B, cls-rank/1)", () => {
    it("has exactly 19 entries and version cls-rank/1", () => {
        expect(RANK_ORDER).toHaveLength(19);
        expect(RANK_TABLE_VERSION).toBe("cls-rank/1");
        expect(new Set(RANK_ORDER).size).toBe(19);
    });

    it("preserves the deliberate quirks: unknown outranks model.response, secret is last", () => {
        expect(clsRank("unknown")).toBeGreaterThan(clsRank("model.response"));
        expect(clsRank("unknown")).toBeLessThan(clsRank("token"));
        expect(RANK_ORDER[RANK_ORDER.length - 1]).toBe("secret");
        expect(clsRank("not-a-class")).toBe(RANK_ORDER.length);
    });

    it("never sorts lexicographically (secret would sort before sql.text)", () => {
        expect("secret" < "sql.text").toBe(true); // the trap
        expect(clsRank("secret")).toBeGreaterThan(clsRank("sql.text")); // the fix
        expect(maxClassification("sql.text", "secret")).toBe("secret");
    });
});

describe("upload policies (design §7.2, addendum §5)", () => {
    it("every policy refuses secret and never keeps sql.text/row.data/prompts/credentials", () => {
        for (const policy of Object.values(UPLOAD_POLICIES)) {
            expect(policy.rules.secret).toBe("refuse");
            for (const cls of [
                "sql.text",
                "row.data",
                "model.prompt",
                "model.response",
                "token",
                "connection.string",
            ] as const) {
                expect(policy.rules[cls], `${policy.policyId} ${cls}`).toBe("drop");
            }
        }
    });

    it("ci-official cannot upload diagnostic sessions; team policies can", () => {
        expect(UPLOAD_POLICIES["ci-official.v1"].allowedKinds).toEqual(["perfRun"]);
        expect(UPLOAD_POLICIES["team-default.v1"].allowedKinds).toContain("diagSession");
    });

    it("team-default digests names; team-names keeps them", () => {
        expect(UPLOAD_POLICIES["team-default.v1"].rules["server.name"]).toBe("digest");
        expect(UPLOAD_POLICIES["team-default.v1"].rules["object.name"]).toBe("digest");
        expect(UPLOAD_POLICIES["team-names.v1"].rules["server.name"]).toBe("keep");
        expect(UPLOAD_POLICIES["team-names.v1"].rules["source.path"]).toBe("digest");
        expect(UPLOAD_POLICIES["elevated-support.v1"].rules["source.path"]).toBe("keep");
    });
});

describe("sql literal encoder (addendum C-11)", () => {
    it("doubles quotes and wraps as N-string", () => {
        expect(sqlNString("O'Brien")).toBe("N'O''Brien'");
        expect(sqlNString("it''s")).toBe("N'it''''s'");
        expect(sqlNString("no quotes")).toBe("N'no quotes'");
    });

    it("refuses NUL and unpaired surrogates (sanitization is the projector's job)", () => {
        expect(() => sqlNString(`a${NUL}b`)).toThrow(/NUL/);
        const lonely = "x" + String.fromCharCode(0xd800) + "y";
        expect(hasUnpairedSurrogate(lonely)).toBe(true);
        expect(() => sqlNString(lonely)).toThrow(/surrogate/);
    });

    it("enforces the byte budget", () => {
        const big = "a".repeat(DEFAULT_MAX_ITEM_BYTES);
        expect(() => sqlNString(big)).toThrow(/budget/);
        expect(() => sqlNString("small", 4)).toThrow(/budget/);
    });

    it("sanitizePayloadString strips NUL and repairs surrogates, reporting the change", () => {
        const s1 = sanitizePayloadString(`a${NUL}b`);
        expect(s1).toEqual({ value: "ab", changed: true });
        const s2 = sanitizePayloadString("x" + String.fromCharCode(0xd800) + "y");
        expect(s2.changed).toBe(true);
        expect(hasUnpairedSurrogate(s2.value)).toBe(false);
        expect(sanitizePayloadString("clean").changed).toBe(false);
    });

    it("sqlLiteral handles numbers, booleans, null; rejects non-finite", () => {
        expect(sqlLiteral(null)).toBe("NULL");
        expect(sqlLiteral(1.5)).toBe("1.5");
        expect(sqlLiteral(true)).toBe("1");
        expect(sqlLiteral("s")).toBe("N's'");
        expect(() => sqlLiteral(Infinity)).toThrow(/non-finite/);
    });
});
