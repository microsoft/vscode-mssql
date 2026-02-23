/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CodeAnalysisRuleSeverity } from "../enums";

export { CodeAnalysisRuleSeverity };

/**
 * Represents a SQL code analysis rule
 */
export interface SqlCodeAnalysisRule {
    /** The unique identifier for the rule (e.g., "Microsoft.Rules.Data.SR0001") */
    ruleId: string;
    /** The short identifier for the rule (e.g., "SR0001") */
    shortRuleId: string;
    /** The display name of the rule */
    displayName: string;
    /** The current configured severity of the rule */
    severity: string;
    /** Whether this rule is enabled */
    enabled: boolean;
}

/**
 * State for the Code Analysis dialog
 */
export interface CodeAnalysisState {
    /** Path to the SQL project file */
    projectFilePath: string;
    /** Project name */
    projectName: string;
    /** Loading indicator */
    isLoading: boolean;
    /** All available code analysis rules */
    rules: SqlCodeAnalysisRule[];
    /** Whether there are unsaved changes */
    hasChanges: boolean;
    /** Error message if any */
    errorMessage?: string;
    /** Success message if any */
    successMessage?: string;
}

/**
 * Reducers (actions) the Code Analysis controller supports
 */
export interface CodeAnalysisReducers {
    /** Close the dialog */
    close: {};
}

/**
 * Provider interface for Code Analysis context
 */
export interface CodeAnalysisProvider {
    close: () => void;
}
