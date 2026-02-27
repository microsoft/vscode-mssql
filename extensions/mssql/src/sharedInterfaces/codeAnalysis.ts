/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DialogMessageSpec } from "./dialogMessage";
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
    /** The category of the rule (for grouped display) */
    category: string;
    /** The rule description */
    description?: string;
    /** The rule scope (Element/Model) */
    ruleScope?: string;
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
    /** All available code analysis rules (current saved state) */
    rules: SqlCodeAnalysisRule[];
    /** DacFx factory defaults — set once on load, never overwritten; used for Reset */
    dacfxStaticRules: SqlCodeAnalysisRule[];
    /** Whether code analysis should run as part of every project build */
    enableCodeAnalysisOnBuild: boolean;
    /** Message to display to the user (errors, warnings, etc.) */
    message?: DialogMessageSpec;
}

/**
 * Reducers (actions) the Code Analysis controller supports
 */
export interface CodeAnalysisReducers {
    /** Close the dialog */
    close: {};
    /** Clear the message bar */
    closeMessage: {};
    /** Save rule overrides to the .sqlproj file */
    saveRules: {
        rules: SqlCodeAnalysisRule[];
        closeAfterSave: boolean;
        enableCodeAnalysisOnBuild: boolean;
    };
}

/**
 * Provider interface for Code Analysis context
 */
export interface CodeAnalysisProvider {
    close: () => void;
    closeMessage: () => void;
    saveRules: (
        rules: SqlCodeAnalysisRule[],
        closeAfterSave: boolean,
        enableCodeAnalysisOnBuild: boolean,
    ) => void;
}
