/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { customRulesCategory, SqlCodeAnalysisRule } from "../../../sharedInterfaces/codeAnalysis";
import { CodeAnalysisCategoryOrder } from "../../../enums";
import { allSeverities } from "../../common/constants";

/**
 * Filters a list of SQL code analysis rules by free-text search and/or severity.
 *
 * Text search is case-insensitive and matches against:
 *  - ruleId        (e.g. "Microsoft.Rules.Data.SR0001")
 *  - shortRuleId   (e.g. "SR0001")
 *  - displayName   (e.g. "Avoid using SELECT * in stored procedures")
 *  - description   (optional full rule description)
 *  - category      (e.g. "Design")
 */
export function filterRules(
    rules: SqlCodeAnalysisRule[],
    searchText: string,
    severityFilter: string,
): SqlCodeAnalysisRule[] {
    const search = searchText.trim().toLowerCase();
    const bySeverity = severityFilter === allSeverities ? "" : severityFilter;

    return rules.filter((rule) => {
        if (bySeverity && rule.severity !== bySeverity) {
            return false;
        }
        if (!search) {
            return true;
        }
        return (
            rule.ruleId.toLowerCase().includes(search) ||
            rule.shortRuleId.toLowerCase().includes(search) ||
            rule.displayName.toLowerCase().includes(search) ||
            (rule.description?.toLowerCase().includes(search) ?? false) ||
            rule.category.toLowerCase().includes(search)
        );
    });
}

/**
 * A category holding any built-in rule is ordered with the built-in categories. A custom rule that
 * declares an existing built-in category therefore joins that group rather than starting a
 * duplicate one further down the list.
 */
function categoryOrder(category: string, rules: SqlCodeAnalysisRule[]): CodeAnalysisCategoryOrder {
    if (category === customRulesCategory) {
        return CodeAnalysisCategoryOrder.UncategorizedCustom;
    }
    return rules.some((rule) => rule.isBuiltIn)
        ? CodeAnalysisCategoryOrder.BuiltIn
        : CodeAnalysisCategoryOrder.Custom;
}

/**
 * Buckets rules by category for the grouped rule table.
 *
 * Categories are ordered built-in first, then categorized custom rules, then the
 * {@link customRulesCategory} catch-all; ties break alphabetically. Rules inside a category are
 * ordered alphabetically by display name.
 */
export function groupRulesByCategory(
    rules: SqlCodeAnalysisRule[],
): [string, SqlCodeAnalysisRule[]][] {
    const grouped = new Map<string, SqlCodeAnalysisRule[]>();
    for (const rule of rules) {
        const bucket = grouped.get(rule.category);
        if (bucket) {
            bucket.push(rule);
        } else {
            grouped.set(rule.category, [rule]);
        }
    }

    for (const bucket of grouped.values()) {
        bucket.sort((a, b) => a.displayName.localeCompare(b.displayName));
    }

    return Array.from(grouped.entries()).sort(([categoryA, rulesA], [categoryB, rulesB]) => {
        const orderA = categoryOrder(categoryA, rulesA);
        const orderB = categoryOrder(categoryB, rulesB);
        return orderA === orderB ? categoryA.localeCompare(categoryB) : orderA - orderB;
    });
}
