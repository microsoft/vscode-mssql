/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { filterRules } from "../../../../src/webviews/pages/CodeAnalysis/codeAnalysisUtils";
import { allSeverities } from "../../../../src/webviews/common/constants";
import {
    CodeAnalysisRuleSeverity,
    SqlCodeAnalysisRule,
} from "../../../../src/sharedInterfaces/codeAnalysis";

// Minimal rule factory â€” only fields used by filterRules need values
function makeRule(base: {
    shortRuleId: string;
    displayName: string;
    category: string;
    severity: string;
    description?: string;
    ruleId?: string;
}): SqlCodeAnalysisRule {
    return {
        ruleId: base.ruleId ?? `${base.category}.${base.shortRuleId}`,
        shortRuleId: base.shortRuleId,
        displayName: base.displayName,
        description: base.description ?? "",
        category: base.category,
        severity: base.severity,
        enabled: true,
        helpLink: "",
    } as SqlCodeAnalysisRule;
}

const RULES: SqlCodeAnalysisRule[] = [
    makeRule({
        shortRuleId: "SR0001",
        displayName: "Column has no default value",
        description: "Columns should have a default value to avoid NULLs.",
        category: "Microsoft.Rules.Data",
        severity: CodeAnalysisRuleSeverity.Warning,
    }),
    makeRule({
        shortRuleId: "SR0006",
        displayName: "Move column default to table",
        description: "Default constraints should live on the table, not a column.",
        category: "Microsoft.Rules.Data",
        severity: CodeAnalysisRuleSeverity.Error,
    }),
    makeRule({
        shortRuleId: "SR1004",
        displayName: "Use primary key",
        description: "Tables should have a primary key.",
        category: "Microsoft.Rules.Naming",
        severity: CodeAnalysisRuleSeverity.Warning,
    }),
    makeRule({
        shortRuleId: "SR2109",
        displayName: "Avoid alias collision",
        description: "",
        category: "Microsoft.Rules.Naming",
        severity: CodeAnalysisRuleSeverity.Disabled,
    }),
];

suite("codeAnalysis - filterRules", () => {
    test("empty search + allSeverities returns all rules", () => {
        const result = filterRules(RULES, "", allSeverities);
        expect(result).to.have.length(RULES.length);
    });

    test("empty rules array returns empty", () => {
        const result = filterRules([], "SR0001", allSeverities);
        expect(result).to.deep.equal([]);
    });

    // --- Search text ---
    test("search by shortRuleId - case-insensitive", () => {
        const result = filterRules(RULES, "sr0001", allSeverities);
        expect(result).to.have.length(1);
        expect(result[0].shortRuleId).to.equal("SR0001");
    });

    test("search by displayName - partial match", () => {
        const result = filterRules(RULES, "primary key", allSeverities);
        expect(result).to.have.length(1);
        expect(result[0].shortRuleId).to.equal("SR1004");
    });

    test("search by category - matches multiple rules", () => {
        const result = filterRules(RULES, "Microsoft.Rules.Data", allSeverities);
        expect(result).to.have.length(2);
        expect(result.map((r) => r.shortRuleId)).to.have.members(["SR0001", "SR0006"]);
    });

    test("search with no matches returns empty array", () => {
        const result = filterRules(RULES, "zzznomatch", allSeverities);
        expect(result).to.deep.equal([]);
    });

    test("search by full ruleId - exact match", () => {
        const result = filterRules(RULES, "Microsoft.Rules.Data.SR0001", allSeverities);
        expect(result).to.have.length(1);
        expect(result[0].shortRuleId).to.equal("SR0001");
    });

    test("search by full ruleId - case-insensitive", () => {
        const result = filterRules(RULES, "microsoft.rules.data.sr0006", allSeverities);
        expect(result).to.have.length(1);
        expect(result[0].shortRuleId).to.equal("SR0006");
    });

    test("search by full ruleId - partial namespace matches multiple rules", () => {
        // "Microsoft.Rules" is a prefix shared by all four ruleIds
        const result = filterRules(RULES, "Microsoft.Rules", allSeverities);
        expect(result).to.have.length(RULES.length);
    });

    // --- Severity filter ---
    test("severity filter Warning returns only Warning rules", () => {
        const result = filterRules(RULES, "", CodeAnalysisRuleSeverity.Warning);
        expect(result).to.have.length(2);
        expect(result.every((r) => r.severity === CodeAnalysisRuleSeverity.Warning)).to.be.true;
    });

    test("severity filter Error returns only Error rules", () => {
        const result = filterRules(RULES, "", CodeAnalysisRuleSeverity.Error);
        expect(result).to.have.length(1);
        expect(result[0].shortRuleId).to.equal("SR0006");
    });

    test("severity filter Disabled returns only Disabled rules", () => {
        const result = filterRules(RULES, "", CodeAnalysisRuleSeverity.Disabled);
        expect(result).to.have.length(1);
        expect(result[0].shortRuleId).to.equal("SR2109");
    });

    // --- Combined search + severity ---
    test("combined: search + severity narrows to intersection", () => {
        // "column" appears in SR0001 (Warning) and SR0006 (Error)
        const result = filterRules(RULES, "column", CodeAnalysisRuleSeverity.Warning);
        expect(result).to.have.length(1);
        expect(result[0].shortRuleId).to.equal("SR0001");
    });

    test("combined: matching search but wrong severity returns empty", () => {
        const result = filterRules(RULES, "SR1004", CodeAnalysisRuleSeverity.Error);
        expect(result).to.deep.equal([]);
    });
});
