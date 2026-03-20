/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SqlCodeAnalysisRule } from "../../../sharedInterfaces/codeAnalysis";
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
