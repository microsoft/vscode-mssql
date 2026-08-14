/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    filterRules,
    groupRulesByCategory,
} from "../../../../src/webviews/pages/CodeAnalysis/codeAnalysisUtils";
import { allSeverities } from "../../../../src/webviews/common/constants";
import {
    CodeAnalysisRuleSeverity,
    customRulesCategory,
    SqlCodeAnalysisRule,
} from "../../../../src/sharedInterfaces/codeAnalysis";

// Minimal rule factory — only fields used by filterRules need values
function makeRule(base: {
    shortRuleId: string;
    displayName: string;
    category: string;
    severity: string;
    description?: string;
    ruleId?: string;
    isBuiltIn?: boolean;
}): SqlCodeAnalysisRule {
    return {
        ruleId: base.ruleId ?? `${base.category}.${base.shortRuleId}`,
        shortRuleId: base.shortRuleId,
        displayName: base.displayName,
        description: base.description ?? "",
        category: base.category,
        severity: base.severity,
        enabled: true,
        isBuiltIn: base.isBuiltIn ?? true,
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

suite("codeAnalysis - groupRulesByCategory", () => {
    const builtInDesign = makeRule({
        shortRuleId: "SR0001",
        displayName: "Zebra rule",
        category: "Design",
        severity: CodeAnalysisRuleSeverity.Warning,
    });
    const builtInDesignSecond = makeRule({
        shortRuleId: "SR0002",
        displayName: "Alpha rule",
        category: "Design",
        severity: CodeAnalysisRuleSeverity.Warning,
    });
    const builtInNaming = makeRule({
        shortRuleId: "SR0003",
        displayName: "Naming rule",
        category: "Naming",
        severity: CodeAnalysisRuleSeverity.Warning,
    });
    const customPerformance = makeRule({
        shortRuleId: "ER0001",
        displayName: "Avoid WAITFOR DELAY",
        category: "Performance",
        severity: CodeAnalysisRuleSeverity.Warning,
        isBuiltIn: false,
    });
    const uncategorizedCustom = makeRule({
        shortRuleId: "ER0002",
        displayName: "Smell check",
        category: customRulesCategory,
        severity: CodeAnalysisRuleSeverity.Warning,
        isBuiltIn: false,
    });

    test("empty input returns no groups", () => {
        expect(groupRulesByCategory([])).to.deep.equal([]);
    });

    test("buckets rules under their category", () => {
        const result = groupRulesByCategory([builtInDesign, builtInDesignSecond, builtInNaming]);

        expect(result.map(([category]) => category)).to.deep.equal(["Design", "Naming"]);
        expect(result[0][1].map((rule) => rule.shortRuleId)).to.have.members(["SR0001", "SR0002"]);
    });

    test("orders built-in categories before custom categories", () => {
        // "Performance" sorts before "Naming" alphabetically, so ordering must be driven by
        // isBuiltIn rather than the category name.
        const result = groupRulesByCategory([customPerformance, builtInNaming]);

        expect(result.map(([category]) => category)).to.deep.equal(["Naming", "Performance"]);
    });

    test("orders the custom-rules catch-all group last", () => {
        const result = groupRulesByCategory([
            uncategorizedCustom,
            customPerformance,
            builtInNaming,
        ]);

        expect(result.map(([category]) => category)).to.deep.equal([
            "Naming",
            "Performance",
            customRulesCategory,
        ]);
    });

    test("sorts categories of equal rank alphabetically", () => {
        const result = groupRulesByCategory([builtInNaming, builtInDesign]);

        expect(result.map(([category]) => category)).to.deep.equal(["Design", "Naming"]);
    });

    test("sorts rules within a category by display name", () => {
        const result = groupRulesByCategory([builtInDesign, builtInDesignSecond]);

        expect(result[0][1].map((rule) => rule.displayName)).to.deep.equal([
            "Alpha rule",
            "Zebra rule",
        ]);
    });

    test("keeps a custom rule that reuses a built-in category in that built-in group", () => {
        const customInBuiltInCategory = makeRule({
            shortRuleId: "ER0003",
            displayName: "Custom design rule",
            category: "Design",
            severity: CodeAnalysisRuleSeverity.Warning,
            isBuiltIn: false,
        });

        const result = groupRulesByCategory([
            customInBuiltInCategory,
            builtInDesign,
            customPerformance,
        ]);

        expect(
            result.map(([category]) => category),
            "Design stays with the built-in categories even though it also holds a custom rule",
        ).to.deep.equal(["Design", "Performance"]);
        expect(result[0][1]).to.have.length(2);
    });
});
