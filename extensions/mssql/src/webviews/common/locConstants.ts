/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from "@vscode/l10n";
import type { ConfigurableKeyCommandId } from "../../sharedInterfaces/shortcutsConfiguration";
import { WebviewAction } from "../../sharedInterfaces/webview";

export class LocConstants {
    private static _instance = new LocConstants();
    private constructor() {}

    public static getInstance(): LocConstants {
        return LocConstants._instance;
    }

    public static createInstance(): void {
        LocConstants._instance = new LocConstants();
    }

    // Warning: Only update these strings if you are sure you want to affect _all_ locations they're shared between.
    public get common() {
        return {
            delete: l10n.t("Delete"),
            cancel: l10n.t("Cancel"),
            areYouSure: l10n.t("Are you sure?"),
            areYouSureYouWantTo: (action: string) =>
                l10n.t({
                    message: "Are you sure you want to {0}?",
                    args: [action],
                    comment: ["{0} is the action being confirmed"],
                }),
            close: l10n.t("Close"),
            copy: l10n.t("Copy"),
            apply: l10n.t("Apply"),
            next: l10n.t("Next"),
            clearSelection: l10n.t("Clear Selection"),
            clear: l10n.t("Clear"),
            find: l10n.t("Find"),
            findNext: l10n.t("Find Next"),
            findPrevious: l10n.t("Find Previous"),
            property: l10n.t("Property"),
            value: l10n.t("Value"),
            noResults: l10n.t("No results"),
            searchResultSummary: (activeElement: number, totalElements: number) =>
                l10n.t({
                    message: "{0} of {1}",
                    args: [activeElement, totalElements],
                    comment: [
                        "{0} is the number of active elements",
                        "{1} is the total number of elements",
                    ],
                }),
            closeFind: l10n.t("Close Find"),
            load: l10n.t("Load"),
            select: l10n.t("Select"),
            finish: l10n.t("Finish"),
            retry: l10n.t("Retry"),
            refresh: l10n.t("Refresh"),
            showPassword: l10n.t("Show password"),
            hidePassword: l10n.t("Hide password"),
            save: l10n.t("Save"),
            tryIt: l10n.t("Try it"),
            dismiss: l10n.t("Dismiss"),
            expand: l10n.t("Expand"),
            collapse: l10n.t("Collapse"),
            error: l10n.t("Error"),
            getStarted: l10n.t("Get Started"),
            back: l10n.t("Back"),
            warning: l10n.t("Warning"),
            signIn: l10n.t("Sign In"),
            loading: l10n.t("Loading"),
            loadingWithEllipsis: l10n.t("Loading..."),
            general: l10n.t("General"),
            databaseNameRequired: l10n.t("Database name is required"),
            databaseNameTooLong: l10n.t("Database name must be 128 characters or fewer"),
            previous: l10n.t("Previous"),
            ok: l10n.t("OK"),
            groupBy: l10n.t("Group by"),
            none: l10n.t("None"),
            stepOf: (currentStep: number, totalSteps: number) =>
                l10n.t({
                    message: "Step {0} of {1}",
                    args: [currentStep, totalSteps],
                    comment: ["{0} is the current step number", "{1} is the total number of steps"],
                }),
            learnMore: l10n.t("Learn more"),
            moveUp: l10n.t("Move Up"),
            moveDown: l10n.t("Move Down"),
            copied: l10n.t("Copied"),
        };
    }

    public get objectExplorerFiltering() {
        return {
            filterSettings: l10n.t("Filter Settings"),
            clearAll: l10n.t("Clear All"),
            ok: l10n.t("OK"),
            and: l10n.t("And"),
            contains: l10n.t("Contains"),
            notContains: l10n.t("Not Contains"),
            startsWith: l10n.t("Starts With"),
            notStartsWith: l10n.t("Not Starts With"),
            endsWith: l10n.t("Ends With"),
            notEndsWith: l10n.t("Not Ends With"),
            equals: l10n.t("Equals"),
            notEquals: l10n.t("Not Equals"),
            lessThan: l10n.t("Less Than"),
            lessThanOrEquals: l10n.t("Less Than or Equals"),
            greaterThan: l10n.t("Greater Than"),
            greaterThanOrEquals: l10n.t("Greater Than or Equals"),
            between: l10n.t("Between"),
            notBetween: l10n.t("Not Between"),
            path: (path: string) =>
                l10n.t({
                    message: "Path: {0}",
                    args: [path],
                    comment: ["{0} is the path of the node in the object explorer"],
                }),
            firstValueEmptyError: (operator: string, filterName: string) =>
                l10n.t({
                    message: "The first value must be set for the {0} operator in the {1} filter",
                    args: [operator, filterName],
                    comment: [
                        "{0} is the operator for the filter",
                        "{1} is the name of the filter",
                    ],
                }),
            secondValueEmptyError: (operator: string, filterName: string) =>
                l10n.t({
                    message: "The second value must be set for the {0} operator in the {1} filter",
                    args: [operator, filterName],
                    comment: [
                        "{0} is the operator for the filter",
                        "{1} is the name of the filter",
                    ],
                }),
            firstValueLessThanSecondError: (operator: string, filterName: string) =>
                l10n.t({
                    message:
                        "The first value must be less than the second value for the {0} operator in the {1} filter",
                    args: [operator, filterName],
                    comment: [
                        "{0} is the operator for the filter",
                        "{1} is the name of the filter",
                    ],
                }),
            property: this.common.property,
            operator: l10n.t("Operator"),
            value: this.common.value,
            clear: l10n.t("Clear"),
        };
    }

    public get tableDesigner() {
        return {
            publishingChanges: l10n.t("Publishing Changes"),
            changesPublishedSuccessfully: l10n.t("Changes published successfully"),
            closeDesigner: l10n.t("Close Designer"),
            continueEditing: l10n.t("Continue Editing"),
            loadingTableDesigner: l10n.t("Loading Table Designer"),
            loadingPreviewReport: l10n.t("Loading Report"),
            errorLoadingPreview: l10n.t("Error loading preview"),
            retry: l10n.t("Retry"),
            updateDatabase: l10n.t("Update Database"),
            generateScript: l10n.t("Generate Script"),
            publish: l10n.t("Publish"),
            previewDatabaseUpdates: l10n.t("Preview Database Updates"),
            errorLoadingDesigner: l10n.t("Error loading Table Designer"),
            severity: l10n.t("Severity"),
            description: l10n.t("Description"),
            scriptAsCreate: l10n.t("Script as Create"),
            designerPreviewConfirmation: l10n.t(
                "I have read the summary and understand the potential risks.",
            ),
            copyScript: l10n.t("Copy script"),
            openInEditor: l10n.t("Open in editor"),
            maximizePanelSize: l10n.t("Maximize panel size"),
            restorePanelSize: l10n.t("Restore panel size"),
            issuesTabHeader: (issueCount: number) =>
                l10n.t({
                    message: "Issues ({0})",
                    args: [issueCount],
                    comment: ["{0} is the number of issues"],
                }),
            propertiesPaneTitle: (objectType: string) =>
                l10n.t({
                    message: "{0} properties",
                    args: [objectType],
                    comment: ["{0} is the object type"],
                }),
            expandPropertiesPane: l10n.t("Expand properties pane"),
            restorePropertiesPane: l10n.t("Restore properties pane"),
            closePropertiesPane: l10n.t("Close properties pane"),
            tableName: l10n.t("Table name"),
            remove: (objectType: string) =>
                l10n.t({
                    message: "Remove {0}",
                    args: [objectType],
                    comment: ["{0} is the object type"],
                }),
            schema: l10n.t("Schema"),
            backToPreview: l10n.t("Back to preview"),
            copy: l10n.t("Copy"),
            youMustReviewAndAccept: l10n.t("You must review and accept the terms to proceed"),
            issue: (issueCount: number) =>
                l10n.t({
                    message: "{0} issue",
                    args: [issueCount],
                    comment: ["{0} is the number of issues"],
                }),
            issues: (issueCount: number) =>
                l10n.t({
                    message: "{0} issues",
                    args: [issueCount],
                    comment: ["{0} is the number of issues"],
                }),
            tabIssue: (tabName: string, issueCount: number) =>
                l10n.t({
                    message: "{0} {1} issue",
                    args: [tabName, issueCount],
                    comment: ["{0} is the tab name", "{1} is the number of issues"],
                }),
            tabIssues: (tabName: string, issueCount: number) =>
                l10n.t({
                    message: "{0} {1} issues",
                    args: [tabName, issueCount],
                    comment: ["{0} is the tab name", "{1} is the number of issues"],
                }),
        };
    }

    public get publishDialog() {
        return {
            publishChanges: l10n.t("Apply Changes"),
            publish: l10n.t("Publish"),
            openPublishScript: l10n.t("Open Publish Script"),
            confirmationText: l10n.t("I have read the summary and understand the potential risks."),
        };
    }

    public get codeAnalysis() {
        return {
            codeAnalysisTitle: (projectName: string) =>
                l10n.t({
                    message: "Code Analysis - {0}",
                    args: [projectName],
                    comment: ["{0} is the name of the database project"],
                }),
            loadingCodeAnalysisRules: l10n.t("Loading code analysis rules..."),
            noCodeAnalysisRulesAvailable: l10n.t("No code analysis rules available."),
            rulesCount: (ruleCount: number) =>
                l10n.t({
                    message: "{0} rules",
                    args: [ruleCount],
                    comment: ["{0} is the number of code analysis rules"],
                }),
            rules: l10n.t("Rules"),
            severity: l10n.t("Severity"),
            enableRule: (ruleId: string) =>
                l10n.t({
                    message: "Enable {0}",
                    args: [ruleId],
                    comment: ["{0} is the rule identifier, e.g. SR0001"],
                }),
            enableCategory: (category: string) =>
                l10n.t({
                    message: "Enable all rules in {0}",
                    args: [category],
                    comment: ["{0} is the category name, e.g. Design"],
                }),
            expandCategory: (category: string) =>
                l10n.t({
                    message: "Expand {0}",
                    args: [category],
                    comment: ["{0} is the category name, e.g. Design"],
                }),
            collapseCategory: (category: string) =>
                l10n.t({
                    message: "Collapse {0}",
                    args: [category],
                    comment: ["{0} is the category name, e.g. Design"],
                }),
            severityForRule: (ruleId: string) =>
                l10n.t({
                    message: "Severity for {0}",
                    args: [ruleId],
                    comment: ["{0} is the rule identifier, e.g. SR0001"],
                }),
            reset: l10n.t("Reset"),
            resetConfirmTitle: l10n.t("Reset to Defaults?"),
            resetConfirmMessage: l10n.t(
                "This will reset all rules to their default severity and disable 'Enable Code Analysis on Build'. This cannot be undone. Would you like to continue?",
            ),
            unsavedChangesTitle: l10n.t("Unsaved Changes"),
            unsavedChangesMessage: l10n.t(
                "You have unsaved changes. Do you want to save before closing?",
            ),
            dontSave: l10n.t("Don't Save"),
            enableCodeAnalysisOnBuild: l10n.t("Enable Code Analysis on Build"),
            searchRules: l10n.t("Search rules..."),
            filterBySeverity: l10n.t("Filter by severity"),
            allSeverities: l10n.t("All severities"),
            noRulesMatchFilter: l10n.t("No rules match the current filter."),
            filteredRulesCount: (filtered: number, total: number) =>
                l10n.t({
                    message: "{0} of {1} rules",
                    args: [filtered, total],
                    comment: ["{0} is the filtered count, {1} is the total count"],
                }),
            ruleEnabled: l10n.t("Rule enabled"),
            ruleDisabled: l10n.t("Rule disabled"),
        };
    }

    public get firewallRules() {
        return {
            createNewFirewallRuleFor: (serverName: string) =>
                l10n.t({
                    message: "Create new firewall rule for {0}",
                    args: [serverName],
                    comment: ["{0} is the server name that the firewall rule will be created for"],
                }),
            createNewFirewallRule: l10n.t("Create a new firewall rule"),
            firewallRuleNeededMessage: l10n.t("A firewall rule is required to access this server."),
            addFirewallRule: l10n.t("Add Firewall Rule"),
            signIntoAzureToAddFirewallRule: l10n.t(
                "Sign into Azure in order to add a firewall rule.",
            ),
            ruleName: l10n.t("Rule name"),
            addMyClientIp: (ipAddress: string) =>
                l10n.t({
                    message: "Add my client IP ({0})",
                    args: [ipAddress],
                    comment: ["{0} is the IP address of the client"],
                }),
            addMySubnetRange: l10n.t("Add my subnet IP range"),
            ipAddressRange: l10n.t("IP address range"),
            fromLabel: l10n.t({
                message: "From",
                comment: ["Label for the start IP address in the firewall rule IP range"],
            }),
            toLabel: l10n.t({
                message: "To",
                comment: ["Label for the end IP address in the firewall rule IP range"],
            }),
        };
    }

    public get shortcutsConfiguration() {
        return {
            title: l10n.t("Shortcuts Configuration (Preview)"),
            pageAriaLabel: l10n.t("Shortcuts configuration page"),
            configurationSections: l10n.t("Configuration sections"),
            subtitle: l10n.t("Configure Quick Query and Extension shortcuts."),
            quickQueries: l10n.t("Quick Queries"),
            quickQueriesDescription: l10n.t(
                "Save frequently used SQL snippets and run or open them instantly with custom keyboard shortcuts.",
            ),
            quickQueriesKeyboardShortcutsBanner: l10n.t(
                "Quick Queries keyboard shortcuts are managed by Visual Studio Code.",
            ),
            openKeyboardShortcutsEditor: l10n.t("Open Keyboard Shortcuts editor."),
            webviewShortcuts: l10n.t("Extension Shortcuts"),
            webviewShortcutsDescription: l10n.t(
                "Configure keyboard shortcuts used by the MSSQL extension.",
            ),
            queryEditorShortcuts: l10n.t("Query Editor"),
            queryEditorKeyboardShortcutsBanner: l10n.t(
                "Query Editor shortcuts are managed by Visual Studio Code.",
            ),
            queryEditorKeyboardShortcutsFooter: l10n.t(
                "Configure the full list of Query Editor shortcuts.",
            ),
            resultViewShortcuts: l10n.t("Result View"),
            resultViewShortcutsBanner: l10n.t(
                "Result View shortcuts are managed by the MSSQL extension. You can configure their keybindings directly here.",
            ),
            keyboardShortcutsEditor: l10n.t("Keyboard Shortcuts editor"),
            viewConfigureKeybinding: l10n.t("View/configure keybinding"),
            viewConfigureKeybindingTooltip: (name: string) =>
                l10n.t({
                    message: "View/configure keybinding for {0}",
                    args: [name],
                    comment: ["{0} is the command or shortcut display name"],
                }),
            configurableKeyCommandCategoryLabels: {
                queryExecution: l10n.t("Query Execution"),
                connection: l10n.t("Connection"),
                others: l10n.t("Others"),
            },
            configurableKeyCommandCategoryDescriptions: {
                queryExecution: l10n.t("Run, cancel, and create queries"),
                connection: l10n.t("Connect and manage database connections"),
                others: l10n.t("Extension and deployment actions"),
            },
            configurableKeyCommandLabels: {
                "mssql.runQuery": l10n.t("Execute Query"),
                "mssql.runCurrentStatement": l10n.t("Execute Selection or Current Statement"),
                "mssql.cancelQuery": l10n.t("Cancel Query"),
                "mssql.newQuery": l10n.t("New Query"),
                "mssql.toggleSqlCmd": l10n.t("Toggle SQLCMD Mode"),
                "mssql.connect": l10n.t("Connect"),
                "mssql.disconnect": l10n.t("Disconnect"),
                "mssql.changeConnection": l10n.t("Change Connection"),
                "mssql.changeDatabase": l10n.t("Change Database"),
                "mssql.showEstimatedPlan": l10n.t("Show Estimated Plan"),
                "mssql.toggleActualPlan": l10n.t("Toggle Actual Plan"),
                "mssql.copyAll": l10n.t("Copy All"),
                "mssql.toggleQueryResultPanel": l10n.t("Toggle Query Result Panel"),
            } satisfies Record<ConfigurableKeyCommandId, string>,
            configurableKeyCommandDescriptions: {
                "mssql.runQuery": l10n.t("Run a query for the current active SQL document"),
                "mssql.runCurrentStatement": l10n.t(
                    "Execute only the T-SQL statement under the cursor",
                ),
                "mssql.cancelQuery": l10n.t("Cancel the query execution in progress"),
                "mssql.newQuery": l10n.t("Open a new SQL query file"),
                "mssql.toggleSqlCmd": l10n.t(
                    "Enable or disable SQLCMD mode for the active SQL document",
                ),
                "mssql.connect": l10n.t("Connect the active SQL document to a database"),
                "mssql.disconnect": l10n.t("Disconnect the active SQL document from the database"),
                "mssql.changeConnection": l10n.t(
                    "Change the connection for the active SQL document",
                ),
                "mssql.changeDatabase": l10n.t("Change the database for the active SQL document"),
                "mssql.showEstimatedPlan": l10n.t("View the estimated query execution plan"),
                "mssql.toggleActualPlan": l10n.t(
                    "Toggle actual execution plan collection for SQL queries",
                ),
                "mssql.copyAll": l10n.t("Copy all query result content"),
                "mssql.toggleQueryResultPanel": l10n.t("Show or hide the query result panel"),
            } satisfies Record<ConfigurableKeyCommandId, string>,
            name: l10n.t("Name"),
            query: l10n.t("Query"),
            shortcut: l10n.t("Shortcut"),
            keybinding: l10n.t("Keybinding"),
            autoExecute: l10n.t("Auto-execute"),
            clearQuickQuery: l10n.t("Clear Quick Query"),
            clearQuickQueryTooltip: l10n.t("Clear this Quick Query"),
            showAllShortcuts: l10n.t("Show All"),
            showAllQuickQueryShortcutsTooltip: l10n.t(
                "Show all Quick Query shortcuts in VS Code Keyboard Shortcuts",
            ),
            quickQuerySlotName: (slotNumber: number) =>
                l10n.t({
                    message: "Query {0}",
                    args: [slotNumber],
                    comment: ["{0} is the Quick Query slot number"],
                }),
            queryDialogTitle: (name: string) =>
                l10n.t({
                    message: "{0} query",
                    args: [name],
                    comment: ["{0} is the Quick Query shortcut name"],
                }),
            queryEditorAriaLabel: (name: string) =>
                l10n.t({
                    message: "Query editor for {0}",
                    args: [name],
                    comment: ["{0} is the Quick Query shortcut name"],
                }),
            noShortcut: l10n.t("No shortcut"),
            noQuerySet: l10n.t("No query set"),
            searchWebviewShortcuts: l10n.t("Search extension shortcut"),
            noShortcutResultsTitle: l10n.t("No matching shortcuts"),
            noShortcutResultsDescription: l10n.t(
                "Try searching by command name, description, or keybinding.",
            ),
            recordShortcut: l10n.t("Record shortcut"),
            recordShortcutDescription: l10n.t(
                "Press desired key combination and then press ENTER.",
            ),
            recordingShortcut: l10n.t("Recording shortcut"),
            shortcutConflict: (target: string) =>
                l10n.t({
                    message: "Already used by {0}",
                    args: [target],
                    comment: ["{0} is the name of the command that already uses this shortcut"],
                }),
            saving: l10n.t("Saving..."),
            saved: l10n.t("Saved"),
            shortcutGroupNavigation: l10n.t("Navigation"),
            shortcutGroupNavigationDescription: l10n.t("Switch between result panes and tabs"),
            shortcutGroupResults: l10n.t("Results"),
            shortcutGroupResultsDescription: l10n.t("Control the results grid display"),
            shortcutGroupSelection: l10n.t("Selection"),
            shortcutGroupSelectionDescription: l10n.t("Move and expand the active grid selection"),
            shortcutGroupCopyExport: l10n.t("Copy & Export"),
            shortcutGroupCopyExportDescription: l10n.t("Copy data and save results to files"),
            webviewShortcutLabels: {
                [WebviewAction.QueryResultSwitchToResultsTab]: l10n.t("Switch to Results tab"),
                [WebviewAction.QueryResultSwitchToMessagesTab]: l10n.t("Switch to Messages tab"),
                [WebviewAction.QueryResultSwitchToQueryPlanTab]: l10n.t("Switch to Query Plan tab"),
                [WebviewAction.QueryResultPrevGrid]: l10n.t("Previous result grid"),
                [WebviewAction.QueryResultNextGrid]: l10n.t("Next result grid"),
                [WebviewAction.QueryResultSwitchToTextView]: l10n.t("Switch results view"),
                [WebviewAction.QueryResultMaximizeGrid]: l10n.t("Maximize results grid"),
                [WebviewAction.ResultGridSelectAll]: l10n.t("Select all"),
                [WebviewAction.ResultGridSelectRow]: l10n.t("Select row"),
                [WebviewAction.ResultGridSelectColumn]: l10n.t("Select column"),
                [WebviewAction.ResultGridToggleSort]: l10n.t("Toggle sort"),
                [WebviewAction.ResultGridChangeColumnWidth]: l10n.t("Change column width"),
                [WebviewAction.ResultGridOpenColumnMenu]: l10n.t("Open column menu"),
                [WebviewAction.ResultGridOpenFilterMenu]: l10n.t("Open filter menu"),
                [WebviewAction.ResultGridExpandSelectionLeft]: l10n.t("Expand selection left"),
                [WebviewAction.ResultGridExpandSelectionRight]: l10n.t("Expand selection right"),
                [WebviewAction.ResultGridExpandSelectionUp]: l10n.t("Expand selection up"),
                [WebviewAction.ResultGridExpandSelectionDown]: l10n.t("Expand selection down"),
                [WebviewAction.ResultGridMoveToRowStart]: l10n.t("Move to row start"),
                [WebviewAction.ResultGridMoveToRowEnd]: l10n.t("Move to row end"),
                [WebviewAction.ResultGridCopySelection]: l10n.t("Copy selection"),
                [WebviewAction.ResultGridCopyWithHeaders]: l10n.t("Copy with headers"),
                [WebviewAction.ResultGridCopyAllHeaders]: l10n.t("Copy all with headers"),
                [WebviewAction.ResultGridCopyAsCsv]: l10n.t("Copy as CSV"),
                [WebviewAction.ResultGridCopyAsJson]: l10n.t("Copy as JSON"),
                [WebviewAction.ResultGridCopyAsInsert]: l10n.t("Copy as INSERT"),
                [WebviewAction.ResultGridCopyAsInClause]: l10n.t("Copy as IN clause"),
                [WebviewAction.QueryResultSaveAsJson]: l10n.t("Save results as JSON"),
                [WebviewAction.QueryResultSaveAsCsv]: l10n.t("Save results as CSV"),
                [WebviewAction.QueryResultSaveAsExcel]: l10n.t("Save results as Excel"),
                [WebviewAction.QueryResultSaveAsInsert]: l10n.t("Save results as INSERT"),
            },
            webviewShortcutDescriptions: {
                [WebviewAction.QueryResultSwitchToResultsTab]: l10n.t(
                    "Focus the Results tab in the query results panel",
                ),
                [WebviewAction.QueryResultSwitchToMessagesTab]: l10n.t("Focus the Messages tab"),
                [WebviewAction.QueryResultSwitchToQueryPlanTab]: l10n.t("Focus the Query Plan tab"),
                [WebviewAction.QueryResultPrevGrid]: l10n.t(
                    "Move focus to the previous result set grid",
                ),
                [WebviewAction.QueryResultNextGrid]: l10n.t(
                    "Move focus to the next result set grid",
                ),
                [WebviewAction.QueryResultSwitchToTextView]: l10n.t(
                    "Toggle between grid and text view",
                ),
                [WebviewAction.QueryResultMaximizeGrid]: l10n.t(
                    "Expand the active grid to fill the panel",
                ),
                [WebviewAction.ResultGridSelectAll]: l10n.t("Select all cells in the active grid"),
                [WebviewAction.ResultGridSelectRow]: l10n.t("Select the entire current row"),
                [WebviewAction.ResultGridSelectColumn]: l10n.t("Select the entire current column"),
                [WebviewAction.ResultGridToggleSort]: l10n.t(
                    "Toggle sorting for the active column",
                ),
                [WebviewAction.ResultGridChangeColumnWidth]: l10n.t(
                    "Resize the active result grid column",
                ),
                [WebviewAction.ResultGridOpenColumnMenu]: l10n.t("Open the active column menu"),
                [WebviewAction.ResultGridOpenFilterMenu]: l10n.t(
                    "Open the active column filter menu",
                ),
                [WebviewAction.ResultGridExpandSelectionLeft]: l10n.t(
                    "Extend the current selection one cell left",
                ),
                [WebviewAction.ResultGridExpandSelectionRight]: l10n.t(
                    "Extend the current selection one cell right",
                ),
                [WebviewAction.ResultGridExpandSelectionUp]: l10n.t(
                    "Extend the current selection one cell up",
                ),
                [WebviewAction.ResultGridExpandSelectionDown]: l10n.t(
                    "Extend the current selection one cell down",
                ),
                [WebviewAction.ResultGridMoveToRowStart]: l10n.t(
                    "Move selection to the first cell in the row",
                ),
                [WebviewAction.ResultGridMoveToRowEnd]: l10n.t(
                    "Move selection to the last cell in the row",
                ),
                [WebviewAction.ResultGridCopySelection]: l10n.t(
                    "Copy selected cells to the clipboard",
                ),
                [WebviewAction.ResultGridCopyWithHeaders]: l10n.t(
                    "Copy selected cells including column headers",
                ),
                [WebviewAction.ResultGridCopyAllHeaders]: l10n.t(
                    "Copy all cells including column headers",
                ),
                [WebviewAction.ResultGridCopyAsCsv]: l10n.t(
                    "Copy selection formatted as comma-separated values",
                ),
                [WebviewAction.ResultGridCopyAsJson]: l10n.t("Copy selection formatted as JSON"),
                [WebviewAction.ResultGridCopyAsInsert]: l10n.t(
                    "Copy selection formatted as INSERT statements",
                ),
                [WebviewAction.ResultGridCopyAsInClause]: l10n.t(
                    "Copy selection formatted as a SQL IN clause",
                ),
                [WebviewAction.QueryResultSaveAsJson]: l10n.t("Export all results to a JSON file"),
                [WebviewAction.QueryResultSaveAsCsv]: l10n.t("Export all results to a CSV file"),
                [WebviewAction.QueryResultSaveAsExcel]: l10n.t(
                    "Export all results to an Excel file",
                ),
                [WebviewAction.QueryResultSaveAsInsert]: l10n.t(
                    "Export all results as INSERT statements",
                ),
            },
        };
    }

    public get connectionDialog() {
        return {
            searchFabricWorkspaces: l10n.t("Search workspaces..."),
            loadingFabricAccounts: l10n.t("Loading Fabric Accounts"),
            fabricAccount: l10n.t("Fabric Account"),
            selectAnAccount: l10n.t("Select an account"),
            account: l10n.t("Account"),
            tenantId: l10n.t("Tenant ID"),
            fabricDatabases: l10n.t("Fabric Databases"),
            fabricWorkspaces: l10n.t("Fabric Workspaces"),
            signIntoFabric: l10n.t("Sign into Fabric"),
            filterByKeyword: l10n.t("Filter by keyword"),
            filter: l10n.t("Filter"),
            filterByType: l10n.t("Filter by type"),
            showAll: l10n.t("Show All"),
            sqlAnalyticsEndpoint: l10n.t("SQL Analytics Endpoint"),
            sqlDatabase: l10n.t("SQL Database"),
            warehouse: l10n.t("Warehouse"),
            noFabricWorkspacesFound: l10n.t("No workspaces found"),
            nameColumnHeader: l10n.t("Name"),
            typeColumnHeader: l10n.t("Type"),
            locationColumnHeader: l10n.t("Location (Workspace)"),
            expandFabricWorkspaceExplorer: l10n.t("Expand Workspace Explorer"),
            explorer: l10n.t("Explorer"),
            collapseFabricWorkspaceExplorer: l10n.t("Collapse Workspace Explorer"),
            expandAzureSubscriptionExplorer: l10n.t("Expand Subscription Explorer"),
            collapseAzureSubscriptionExplorer: l10n.t("Collapse Subscription Explorer"),
            selectAFabricWorkspaceToViewDatabases: l10n.t(
                "Select a workspace to view the databases in it.",
            ),
            noDatabasesFoundInFabricWorkspace: (workspaceName?: string) => {
                if (workspaceName) {
                    return l10n.t({
                        message: "No databases found in workspace '{0}'.",
                        args: [workspaceName],
                        comment: ["{0} is the name of the workspace"],
                    });
                } else {
                    return l10n.t("No databases found in the selected workspace.");
                }
            },
            databaseList: l10n.t("Database list"),
            connect: l10n.t("Connect"),
            connectTooltip: l10n.t(
                "Connect with the current settings and save the connection profile",
            ),
            connectActions: l10n.t("Connection actions"),
            advancedConnectionSettings: l10n.t("Advanced Connection Settings"),
            advancedSettings: l10n.t("Advanced"),
            testConnection: l10n.t("Test connection"),
            testConnectionTooltip: l10n.t("Test connecting with the current settings"),
            testConnectionSucceeded: l10n.t("Connection test succeeded"),
            testing: l10n.t("Testing..."),
            connecting: l10n.t("Connecting..."),
            saveWithoutConnecting: l10n.t("Save without connecting"),
            saveWithoutConnectingTooltip: l10n.t(
                "Save connection profile changes without establishing a connection",
            ),
            connectToDatabase: l10n.t("Connect to Database"),
            editDatabaseConnection: (profileName: string) =>
                l10n.t({
                    message: "Edit Database Connection - {0}",
                    args: [profileName],
                    comment: ["{0} is the name of the connection profile"],
                }),
            editConnection: (profileName: string) =>
                l10n.t({
                    message: "Edit {0}",
                    args: [profileName],
                    comment: ["{0} is the name of the connection profile"],
                }),
            createCopiedConnection: (profileName: string) =>
                l10n.t({
                    message: "Create new connection copied from {0}",
                    args: [profileName],
                    comment: ["{0} is the name of the connection profile"],
                }),
            connectTo: (profileName: string) =>
                l10n.t({
                    message: "Connect to {0}",
                    args: [profileName],
                    comment: ["{0} is the name of the connection profile"],
                }),
            parameters: l10n.t("Parameters"),
            connectionString: l10n.t("Connection String"),
            browseAzure: l10n.t("Browse Azure"),
            browseFabric: l10n.t("Browse Fabric"),
            loadFromConnectionString: l10n.t("Load from Connection String"),
            savedConnections: l10n.t("Saved Connections"),
            recentConnections: l10n.t("Recent Connections"),
            subscriptionLabel: l10n.t("Subscription"),
            subscription: l10n.t("subscription"),
            resourceGroupLabel: l10n.t("Resource Group"),
            resourceGroup: l10n.t("resource group"),
            locationLabel: l10n.t("Location"),
            location: l10n.t("location"),
            serverLabel: l10n.t("Server"),
            server: l10n.t("server"),
            databaseLabel: l10n.t("Database"),
            database: l10n.t("database"),
            filterSubscriptions: l10n.t("Filter Azure subscriptions"),
            connectionErrorTitle: l10n.t("Connection Error"),
            trustServerCertMessage: l10n.t(
                "Encryption was enabled on this connection; review your SSL and certificate configuration for the target SQL Server, or enable 'Trust server certificate' in the connection dialog.",
            ),
            trustServerCertPrompt: l10n.t(
                "Note: A self-signed certificate offers only limited protection and is not a recommended practice for production environments. Do you want to enable 'Trust server certificate' on this connection and retry?",
            ),
            readMore: l10n.t("Read more"),
            enableTrustServerCertificateButton: l10n.t("Enable 'Trust Server Certificate'"),
            azureFilterPlaceholder: (dropdownContentType: string) =>
                l10n.t({
                    message: "Select a {0} for filtering",
                    args: [dropdownContentType],
                    comment: [
                        "{0} is the type of the dropdown's contents, e.g 'resource group' or 'server'",
                    ],
                }),
            invalidAzureBrowse: (dropdownContentType: string) =>
                l10n.t({
                    message: "Select a valid {0} from the dropdown",
                    args: [dropdownContentType],
                    comment: [
                        "{0} is the type of the dropdown's contents, e.g 'resource group' or 'server'",
                    ],
                }),
            default: l10n.t("Default"),
            deleteSavedConnection: l10n.t("Delete saved connection"),
            removeRecentConnection: l10n.t("Clear from recent connections list"),
            copyConnectionString: l10n.t("Copy connection string to clipboard"),
            pasteConnectionString: l10n.t("Paste connection string from clipboard"),
            copy: l10n.t("Copy"),
            paste: l10n.t("Paste"),
            searchSettings: l10n.t("Search settings..."),
            signIntoAzureToBrowse: l10n.t(
                "You must be signed into Azure in order to browse SQL databases.",
            ),
            signIntoFabricToBrowse: l10n.t(
                "You must be signed into Fabric in order to browse SQL databases.",
            ),
            azureTenantSignInStatus: (signedIn: number, total: number) =>
                l10n.t({
                    message: "{0} of {1} tenants",
                    args: [signedIn, total],
                    comment: [
                        "{0} is the number of tenants with active sessions",
                        "{1} is the total number of tenants",
                    ],
                }),
            signIntoTenantLink: l10n.t("Sign into tenant"),
            noTenantsSignedIn: l10n.t("No tenants are currently signed in."),
            loadingFabricWorkspaces: l10n.t("Loading workspaces..."),
            loadingFabricWorkspaceDatabases: (workspaceName?: string) => {
                if (workspaceName) {
                    return l10n.t({
                        message: "Loading databases in '{0}'...",
                        args: [workspaceName],
                        comment: ["{0} is the name of the workspace"],
                    });
                } else {
                    return l10n.t("Loading databases in selected workspace...");
                }
            },
            errorLoadingFabricWorkspaces: l10n.t("Error loading workspaces"),
            errorLoadingFabricWorkspaceDatabases: l10n.t("Error loading databases"),
            notSignedIntoTenant: (tenantName: string) =>
                l10n.t({
                    message: "Not signed into tenant {0}",
                    args: [tenantName],
                    comment: ["{0} is the tenant display name"],
                }),
            connectionAuthentication: l10n.t("Connection Authentication"),
            advancedOptions: l10n.t("Advanced Options"),
            importFromAzureDataStudio: l10n.t("Import from Azure Data Studio"),
            addToFavorites: l10n.t("Add to favorites"),
            removeFromFavorites: l10n.t("Remove from favorites"),
            azureDatabases: l10n.t("Azure Databases"),
            azureSubscriptions: l10n.t("Azure Subscriptions"),
            searchSubscriptions: l10n.t("Search subscriptions..."),
            noSubscriptionsFound: l10n.t("No subscriptions found"),
            selectASubscriptionToViewServers: l10n.t(
                "Select a subscription to view servers in it.",
            ),
            noServersFoundInSubscription: (subscriptionName?: string) => {
                if (subscriptionName) {
                    return l10n.t({
                        message: "No servers found in subscription '{0}'.",
                        args: [subscriptionName],
                        comment: ["{0} is the name of the subscription"],
                    });
                } else {
                    return l10n.t("No servers found in the selected subscription.");
                }
            },
            loadingSubscriptions: l10n.t("Loading subscriptions..."),
            loadingServersInSubscription: (subscriptionName?: string) => {
                if (subscriptionName) {
                    return l10n.t({
                        message: "Loading servers in '{0}'...",
                        args: [subscriptionName],
                        comment: ["{0} is the name of the subscription"],
                    });
                } else {
                    return l10n.t("Loading servers in selected subscription...");
                }
            },
            errorLoadingSubscriptions: l10n.t("Error loading subscriptions"),
            errorLoadingServers: l10n.t("Error loading servers"),
            resourceGroupColumnHeader: l10n.t("Resource Group"),
            azureSqlServer: l10n.t("Azure SQL Server"),
            azureSqlManagedInstance: l10n.t("Azure SQL Managed Instance"),
            azureSynapseAnalytics: l10n.t("Azure Synapse Analytics"),
        };
    }

    public get azure() {
        return {
            signIntoAzure: l10n.t("Sign into Azure"),
            notSignedIn: l10n.t("Not signed in"),
            azureAccount: l10n.t("Azure Account"),
            addAccount: l10n.t("Add Account"),
            addAzureAccount: l10n.t("+ Add Azure Account"),
            nAccounts: (n: number) =>
                l10n.t({
                    message: "{0} accounts",
                    args: [n],
                    comment: ["{0} is the number of accounts"],
                }),
            clickToSignIntoAnAzureAccount: l10n.t("Click to sign into an Azure account"),
            currentlySignedInAs: l10n.t("Currently signed in as:"),
            loadingAzureAccounts: l10n.t("Loading Azure Accounts"),
            tenant: l10n.t("Tenant"),
            loadingTenants: l10n.t("Loading tenants..."),
            selectATenant: l10n.t("Select a tenant"),
            tenantNotSignedIn: l10n.t("Not currently signed in. Select to sign in to tenant."),
        };
    }

    public get executionPlan() {
        return {
            loadingExecutionPlan: l10n.t("Loading execution plan..."),
            queryCostRelativeToScript: (index: number, costPercentage: string) =>
                l10n.t({
                    message: "Query {0}:  Query cost (relative to the script):  {1}%",
                    args: [index, costPercentage],
                    comment: ["{0} is the query number", "{1} is the query cost"],
                }),
            equals: l10n.t("Equals"),
            contains: l10n.t("Contains"),
            actualElapsedTime: l10n.t("Actual Elapsed Time"),
            actualElapsedCpuTime: l10n.t("Actual Elapsed CPU Time"),
            cost: l10n.t("Cost"),
            subtreeCost: l10n.t("Subtree Cost"),
            actualNumberOfRowsForAllExecutions: l10n.t("Actual Number of Rows For All Executions"),
            numberOfRowsRead: l10n.t("Number of Rows Read"),
            off: l10n.t("Off"),
            metric: l10n.t("Metric"),
            findNodes: l10n.t("Find Nodes"),
            savePlan: l10n.t("Save Plan"),
            openXml: l10n.t("Open XML"),
            openQuery: l10n.t("Open Query"),
            zoomIn: l10n.t("Zoom In"),
            zoomOut: l10n.t("Zoom Out"),
            zoomToFit: l10n.t("Zoom to Fit"),
            customZoom: l10n.t("Custom Zoom"),
            findNode: l10n.t("Find Node"),
            highlightExpensiveOperation: l10n.t("Highlight Expensive Operation"),
            toggleTooltips: l10n.t("Toggle Tooltips"),
            properties: l10n.t("Properties"),
            name: l10n.t("Name"),
            value: l10n.t("Value"),
            importance: l10n.t("Importance"),
            alphabetical: l10n.t("Alphabetical"),
            reverseAlphabetical: l10n.t("Reverse Alphabetical"),
            expandAll: l10n.t("Expand All"),
            collapseAll: l10n.t("Collapse All"),
            filterAnyField: l10n.t("Filter for any field..."),
            next: l10n.t("Next"),
            previous: l10n.t("Previous"),
            expand: l10n.t("Expand"),
            collapse: l10n.t("Collapse"),
            subtreeCostLabel: l10n.t("Estimated Subtree Cost"),
            operatorCostLabel: l10n.t("Estimated Operator Cost"),
        };
    }

    public get userFeedback() {
        return {
            microsoftWouldLikeYourFeedback: l10n.t("Microsoft would like your feedback"),
            overallHowSatisfiedAreYouWithMSSQLExtension: l10n.t(
                "Overall, how satisfied are you with the MSSQL extension?",
            ),
            verySatisfied: l10n.t("Very Satisfied"),
            satisfied: l10n.t("Satisfied"),
            dissatisfied: l10n.t("Dissatisfied"),
            veryDissatisfied: l10n.t("Very Dissatisfied"),
            submit: l10n.t("Submit"),
            notLikelyAtAll: l10n.t("Not likely at all"),
            extremelyLikely: l10n.t("Extremely likely"),
            privacyNotice: l10n.t("Privacy notice"),
            privacyStatement: l10n.t("Privacy Statement"),
            feedbackStatementLong: l10n.t(
                "Microsoft will process the feedback you submit pursuant to your organization’s instructions in order to improve your and your organization’s experience with this product. If you have any questions about the use of feedback data, please contact your tenant administrator. Processing of feedback data is governed by the Microsoft Products and Services Data Protection Addendum between your organization and Microsoft, and the feedback you submit is considered Personal Data under that addendum.",
            ),
        };
    }

    public get queryResult() {
        return {
            resultTabTooltip: (shortcut?: string) => {
                if (shortcut) {
                    return l10n.t({
                        message: "Results ({0})",
                        args: [shortcut],
                        comment: ["{0} is the keyboard shortcut for the results tab"],
                    });
                }
                return l10n.t("Results");
            },
            resultBetaTabTooltip: (shortcut?: string) => {
                if (shortcut) {
                    return l10n.t({
                        message: "Results Preview ({0})",
                        args: [shortcut],
                        comment: ["{0} is the keyboard shortcut for the preview results tab"],
                    });
                }
                return l10n.t("Results Preview");
            },
            results: (count: number) =>
                l10n.t({
                    message: "Results ({0})",
                    args: [count],
                    comment: ["{0} is the number of results"],
                }),
            resultsBeta: (count: number) =>
                l10n.t({
                    message: "Results Preview ({0})",
                    args: [count],
                    comment: ["{0} is the number of preview results"],
                }),
            messagesTabTooltip: (shortcut?: string) => {
                if (shortcut) {
                    return l10n.t({
                        message: "Messages ({0})",
                        args: [shortcut],
                        comment: ["{0} is the keyboard shortcut for the messages tab"],
                    });
                }
                return l10n.t("Messages");
            },
            messages: l10n.t("Messages"),
            timestamp: l10n.t("Timestamp"),
            message: l10n.t("Message"),
            openResultInNewTab: l10n.t("Open in New Tab"),
            resultsToolbar: l10n.t("Results toolbar"),
            showplanXML: l10n.t("Showplan XML"),
            showMenu: (shortcut: string) => {
                if (shortcut) {
                    return l10n.t({
                        message: "Show Menu ({0})",
                        args: [shortcut],
                        comment: ["{0} is the keyboard shortcut for showing the menu"],
                    });
                }
                return l10n.t("Show Menu");
            },
            sortAscending: l10n.t("Sort Ascending"),
            sortDescending: l10n.t("Sort Descending"),
            toggleSort: l10n.t("Toggle Sort"),
            clearSort: l10n.t("Clear Sort"),
            saveAsCsv: (shortcut: string) => {
                if (shortcut) {
                    return l10n.t({
                        message: "Save as CSV ({0})",
                        args: [shortcut],
                        comment: ["{0} is the keyboard shortcut for saving as CSV"],
                    });
                }
                return l10n.t("Save as CSV");
            },
            saveAsExcel: (shortcut: string) => {
                if (shortcut) {
                    return l10n.t({
                        message: "Save as Excel ({0})",
                        args: [shortcut],
                        comment: ["{0} is the keyboard shortcut for saving as Excel"],
                    });
                }
                return l10n.t("Save as Excel");
            },
            saveAsJson: (shortcut: string) => {
                if (shortcut) {
                    return l10n.t({
                        message: "Save as JSON ({0})",
                        args: [shortcut],
                        comment: ["{0} is the keyboard shortcut for saving as JSON"],
                    });
                }
                return l10n.t("Save as JSON");
            },
            saveAsInsert: (shortcut: string) => {
                if (shortcut) {
                    return l10n.t({
                        message: "Save as INSERT INTO ({0})",
                        args: [shortcut],
                        comment: ["{0} is the keyboard shortcut for saving as INSERT INTO"],
                    });
                }
                return l10n.t("Save as INSERT INTO");
            },
            moreQueryActions: l10n.t("More Query Actions"),
            clickHereToHideThisPanel: l10n.t("Hide this panel"),
            queryPlan: (count: number) => {
                return l10n.t({
                    message: "Query Plan ({0})",
                    args: [count],
                    comment: ["{0} is the number of query plans"],
                });
            },
            queryPlanTooltip: (shortcut?: string) => {
                if (shortcut) {
                    return l10n.t({
                        message: "Query Plan ({0})",
                        args: [shortcut],
                        comment: ["{0} is the keyboard shortcut for the query plan tab"],
                    });
                }
                return l10n.t("Query Plan");
            },
            selectAll: l10n.t("Select All"),
            copy: l10n.t("Copy"),
            copyWithHeaders: l10n.t("Copy with Headers"),
            copyHeaders: l10n.t("Copy Headers"),
            errorFailedToParseQueryResultData: l10n.t("Error: Failed to parse query result data."),
            errorUnrecognizedQueryResultData: l10n.t("Error: Unrecognized query result data."),
            saveAsCSV: l10n.t("Save as CSV"),
            saveAsExcelLabel: l10n.t("Save as Excel"),
            saveAsJSON: l10n.t("Save as JSON"),
            exportToolbarForResultSet: (resultSetIndex: number) =>
                l10n.t({
                    message: "Export toolbar for result set {0}",
                    args: [resultSetIndex],
                    comment: ["{0} is the result set number (1-based index)"],
                }),
            copyAs: l10n.t("Copy As"),
            copyAsCsv: l10n.t("Copy as CSV"),
            copyAsJson: l10n.t("Copy as JSON"),
            copyAsInClause: l10n.t("Copy as IN clause"),
            copyAsInsertInto: l10n.t("Copy as INSERT INTO"),
            null: l10n.t("NULL"),
            blankString: l10n.t("Blanks"),
            apply: l10n.t("Apply"),
            clear: l10n.t("Clear"),
            search: l10n.t("Search..."),
            close: l10n.t("Close"),
            maximize: (shortcut: string) => {
                if (shortcut) {
                    return l10n.t({
                        message: "Maximize ({0})",
                        args: [shortcut],
                        comment: ["{0} is the keyboard shortcut for maximizing the grid"],
                    });
                }
                return l10n.t("Maximize");
            },
            restore: (shortcut: string) => {
                if (shortcut) {
                    return l10n.t({
                        message: "Restore ({0})",
                        args: [shortcut],
                        comment: ["{0} is the keyboard shortcut for restoring the grid"],
                    });
                }
                return l10n.t("Restore");
            },
            toggleToGridView: (shortcut: string) => {
                if (shortcut) {
                    return l10n.t({
                        message: "Switch to Grid View ({0})",
                        args: [shortcut],
                        comment: ["{0} is the keyboard shortcut for switching to grid view"],
                    });
                }
                return l10n.t("Switch to Grid View");
            },
            toggleToTextView: (shortcut: string) => {
                if (shortcut) {
                    return l10n.t({
                        message: "Switch to Text View ({0})",
                        args: [shortcut],
                        comment: ["{0} is the keyboard shortcut for switching to text view"],
                    });
                }
                return l10n.t("Switch to Text View");
            },
            gridView: l10n.t("Grid View"),
            textView: l10n.t("Text View"),
            noResultsToDisplay: l10n.t("No results to display"),
            errorGeneratingTextView: l10n.t(
                "Error generating text view. Please try switching back to grid view.",
            ),
            rowsAffected: (rowCount: number) => {
                switch (rowCount) {
                    case 0:
                        return l10n.t("(0 rows affected)");
                    case 1:
                        return l10n.t("(1 row affected)");
                    default:
                        return l10n.t({
                            message: "({0} rows affected)",
                            args: [rowCount],
                            comment: ["{0} is the number of rows affected"],
                        });
                }
            },
            rowsReturned: (rowCount: number) => {
                switch (rowCount) {
                    case 0:
                        return l10n.t("0 rows returned");
                    case 1:
                        return l10n.t("1 row returned");
                    default:
                        return l10n.t({
                            message: "{0} rows returned",
                            args: [rowCount],
                            comment: ["{0} is the number of rows returned"],
                        });
                }
            },
            rowsCount: (rowCount: number) => {
                switch (rowCount) {
                    case 0:
                        return l10n.t("0 rows");
                    case 1:
                        return l10n.t("1 row");
                    default:
                        return l10n.t({
                            message: "{0} rows",
                            args: [rowCount],
                            comment: ["{0} is the number of rows"],
                        });
                }
            },
            noRowsAffected: l10n.t("No rows affected"),
            selectedItemLabel: l10n.t("Selected"),
            rowsAffectedLabel: l10n.t("Rows"),
            timeLabel: l10n.t("Time"),
            runningLabel: l10n.t("Running"),
            noSelectionSummary: l10n.t("No selection"),
            selectionSummaryCountLabel: l10n.t("Count"),
            selectionSummaryAverageLabel: l10n.t("Avg"),
            selectionSummarySumLabel: l10n.t("Sum"),
            selectionSummaryMinLabel: l10n.t("Min"),
            selectionSummaryMaxLabel: l10n.t("Max"),
            selectionSummaryDistinctLabel: l10n.t("Distinct"),
            selectionSummaryNullLabel: l10n.t("Null"),
            executionCancelled: l10n.t("Execution cancelled"),
            executionTimeUnavailable: l10n.t("Execution time unavailable"),
            runningWithDuration: (duration: string) =>
                l10n.t({
                    message: "Running: {0}",
                    args: [duration],
                    comment: ["{0} is how long the query has been running"],
                }),
            compactMilliseconds: (milliseconds: number) =>
                l10n.t({
                    message: "{0}ms",
                    args: [milliseconds],
                    comment: ["{0} is the number of milliseconds"],
                }),
            compactSeconds: (seconds: number | string) =>
                l10n.t({
                    message: "{0}s",
                    args: [seconds],
                    comment: ["{0} is the number of seconds"],
                }),
            compactMinutes: (minutes: number) =>
                l10n.t({
                    message: "{0}m",
                    args: [minutes],
                    comment: ["{0} is the number of minutes"],
                }),
            compactMinutesSeconds: (minutes: number, seconds: number) =>
                l10n.t({
                    message: "{0}m {1}s",
                    args: [minutes, seconds],
                    comment: ["{0} is the number of minutes", "{1} is the number of seconds"],
                }),
            compactHours: (hours: number) =>
                l10n.t({
                    message: "{0}h",
                    args: [hours],
                    comment: ["{0} is the number of hours"],
                }),
            compactHoursMinutes: (hours: number, minutes: number) =>
                l10n.t({
                    message: "{0}h {1}m",
                    args: [hours, minutes],
                    comment: ["{0} is the number of hours", "{1} is the number of minutes"],
                }),
            resultSet: (batchNumber: number, queryNumber: number) =>
                l10n.t({
                    message: "Result Set Batch {0} - Query {1}",
                    args: [batchNumber, queryNumber],
                    comment: ["{0} is the batch number", "{1} is the query number"],
                }),
            loadingTextView: l10n.t("Loading text view..."),
            loadingResultsMessage: l10n.t("Loading results..."),
            noResultsHeader: l10n.t("No results for the active editor"),
            noResultMessage: l10n.t(
                "Run a query in the current editor, or switch to an editor that has results.",
            ),
            failedToStartQuery: l10n.t("Failed to start query."),
            filterOptions: l10n.t("Filter Options"),
            removeSort: l10n.t("Remove Sort"),
            selectedCount: (count: number) =>
                l10n.t({
                    message: "{0} selected",
                    args: [count],
                    comment: ["{0} is the number of selected rows"],
                }),
            sort: l10n.t("Sort"),
            filter: l10n.t("Filter"),
            resize: l10n.t("Resize"),
            copyColumnName: l10n.t("Copy Column Name"),
            resizeColumn: (columnName: string) => {
                return l10n.t({
                    message: "Resize column '{0}'",
                    args: [columnName],
                    comment: ["{0} is the name of the column"],
                });
            },
            enterDesiredColumnWidth: l10n.t("Enter desired column width in pixels"),
            resizeValidationError: (minWidth: number) => {
                return l10n.t({
                    message: "Column width must be at least {0} pixels.",
                    args: [minWidth],
                    comment: ["{0} is the minimum column width in pixels"],
                });
            },
        };
    }

    public get spatialResults() {
        return {
            spatial: l10n.t("Spatial"),
            analysisLabel: l10n.t("Spatial results analysis"),
            controlsLabel: l10n.t("Spatial controls"),
            featureMapLabel: l10n.t("Spatial feature map"),
            mapZoomControlsLabel: l10n.t("Map zoom controls"),
            zoomIn: l10n.t("Zoom in"),
            zoomOut: l10n.t("Zoom out"),
            featuresLabel: l10n.t("Spatial features"),
            column: l10n.t("Spatial column"),
            label: l10n.t("Label"),
            colorBy: l10n.t("Color by"),
            group: l10n.t("Group"),
            rowNumber: l10n.t("Row number"),
            geometryType: l10n.t("Geometry type"),
            srid: l10n.t("SRID"),
            allGeometryTypes: l10n.t("All geometry types"),
            allSrids: l10n.t("All SRIDs"),
            fit: l10n.t("Fit"),
            renderer: l10n.t("Renderer"),
            automatic: l10n.t("Automatic"),
            canvas: l10n.t("Canvas"),
            clusters: l10n.t("Clusters"),
            gpuPoints: l10n.t("GPU points"),
            renderable: (count: number) =>
                l10n.t({
                    message: "{0} renderable",
                    args: [count.toLocaleString()],
                    comment: ["{0} is the number of renderable spatial features"],
                }),
            unavailable: (count: number) =>
                l10n.t({
                    message: "{0} null / unsupported",
                    args: [count.toLocaleString()],
                    comment: ["{0} is the number of unavailable spatial features"],
                }),
            rowProgress: (scanned: number, total: number) =>
                l10n.t({
                    message: "{0} / {1} rows",
                    args: [scanned.toLocaleString(), total.toLocaleString()],
                    comment: ["{0} is the scanned row count", "{1} is the total row count"],
                }),
            loadingProgress: (scanned: number, total: number) =>
                l10n.t({
                    message: "Loading {0} of {1}…",
                    args: [scanned.toLocaleString(), total.toLocaleString()],
                    comment: ["{0} is the scanned row count", "{1} is the total row count"],
                }),
            limited: (reason: string) =>
                l10n.t({
                    message: "Partial view · safety limit: {0}",
                    args: [reason],
                    comment: ["{0} is a bounded internal safety-limit category"],
                }),
            waiting: l10n.t("Waiting"),
            offline: l10n.t("Offline · no basemap requests"),
            layers: l10n.t("Layers"),
            worldOutline: l10n.t("World outline (offline)"),
            worldOutlineActive: l10n.t("World outline"),
            layerUnavailableForCrs: l10n.t("Map layer unavailable for this coordinate system"),
            layerFailed: l10n.t("Map layer could not be loaded"),
            layerUntrusted: l10n.t("Online layer disabled in an untrusted workspace"),
            layerConsentRequired: l10n.t("Select the layer again to confirm online map access"),
            onlineLayerOption: (name: string) => l10n.t("{0} · online", name),
            onlineLayerActive: (name: string) => l10n.t("Layer: {0}", name),
            groups: (summary: string) =>
                l10n.t({
                    message: "Groups: {0}",
                    args: [summary],
                    comment: ["{0} is a summary of safe spatial type or SRID group counts"],
                }),
            null: l10n.t("Null"),
            empty: l10n.t("Empty"),
            unsupported: l10n.t("Unsupported"),
            detailsLabel: l10n.t("Selected spatial feature details"),
            featureDetails: l10n.t("Feature details"),
            features: l10n.t("Features"),
            collapseFeatureList: l10n.t("Collapse the feature list"),
            expandFeatureList: l10n.t("Expand the feature list"),
            collapseDetails: l10n.t("Collapse feature details"),
            expandDetails: l10n.t("Expand feature details"),
            resizeFeatureList: l10n.t("Resize the feature list"),
            resizeDetails: l10n.t("Resize feature details"),
            mapContextMenuLabel: l10n.t("Map actions"),
            copyImage: l10n.t("Copy image"),
            imageCopied: l10n.t("Map image copied to the clipboard"),
            copyImageFailed: (reason: string) =>
                l10n.t({
                    message: "Copy image failed: {0}",
                    args: [reason],
                    comment: ["{0} is a short error message"],
                }),
            sourceRow: l10n.t("Source row"),
            status: l10n.t("Status"),
            kind: l10n.t("Kind"),
            geometry: l10n.t("Geometry"),
            layout: l10n.t("Layout"),
            vertices: l10n.t("Vertices"),
            parts: l10n.t("Parts"),
            rings: l10n.t("Rings"),
            envelope: l10n.t("Envelope"),
            wkbBytes: l10n.t("WKB bytes"),
            reason: l10n.t("Reason"),
            selectFeature: l10n.t("Select a feature on the map or in the list."),
            noEligibleColumns: l10n.t("No eligible spatial columns."),
            loadingView: l10n.t("Loading Spatial view…"),
            decodeWorkerFailed: l10n.t("Spatial decode worker failed."),
            sessionOpenFailed: l10n.t("Spatial session could not be opened."),
            diagnosticSessions: l10n.t("Sessions"),
            diagnosticDecodedFeatures: l10n.t("Decoded features"),
            diagnosticFirstPaints: l10n.t("First paints"),
            diagnosticPartialErrors: l10n.t("Partial / errors"),
            diagnosticNoActivity: l10n.t("No Spatial activity"),
            diagnosticNoActivityBody: l10n.t(
                "Open an eligible Spatial result tab to see host preparation, worker decode, renderer, interaction, and cleanup evidence here.",
            ),
            diagnosticTime: l10n.t("Time"),
            diagnosticStage: l10n.t("Stage"),
            diagnosticCount: l10n.t("Count"),
            diagnosticDuration: l10n.t("Duration"),
        };
    }

    public get schemaDesigner() {
        return {
            schema: l10n.t("Schema"),
            columns: l10n.t("Columns"),
            newColumn: l10n.t("Add new column"),
            name: l10n.t("Name"),
            table: l10n.t("Table"),
            foreignKeys: l10n.t("Foreign Keys"),
            save: l10n.t("Save"),
            add: l10n.t("Add"),
            cancel: l10n.t("Cancel"),
            dataType: l10n.t("Type"),
            primaryKey: l10n.t("Primary Key"),
            delete: l10n.t("Delete"),
            cannotDeleteColumnUsedInForeignKey: l10n.t(
                "Cannot delete column because it is used by a foreign key.",
            ),
            cannotDeleteColumnReferencedByForeignKey: l10n.t(
                "Cannot delete column because it is referenced by a foreign key.",
            ),
            cannotDeleteColumnUsedByForeignKeyRelations: l10n.t(
                "Cannot delete column because it is part of foreign key relationships.",
            ),
            newForeignKey: l10n.t("Add new foreign key"),
            foreignKeyIndex: (index: number) =>
                l10n.t({
                    message: "Foreign Key {0}",
                    args: [index],
                    comment: ["{0} is the index of the foreign key"],
                }),
            sourceColumn: l10n.t("Source Column"),
            targetTable: l10n.t("Target Table"),
            foreignColumn: l10n.t("Foreign Column"),
            zoomIn: l10n.t("Zoom In"),
            zoomOut: l10n.t("Zoom Out"),
            zoomToFit: l10n.t("Zoom to Fit"),
            export: l10n.t("Export"),
            addTable: l10n.t("Add Table"),
            autoArrange: l10n.t("Auto Arrange"),
            autoArrangeConfirmation: l10n.t("Auto Arrange Confirmation"),
            autoArrangeConfirmationContent: l10n.t(
                "Auto Arrange will automatically reposition all diagram elements based on optimal layout algorithms. Any custom positioning you've created will be lost. Do you want to proceed with auto-arranging your schema diagram?",
            ),
            filter: (selectedTablesCount: number) => {
                if (selectedTablesCount === 0) {
                    return l10n.t("Filter");
                } else {
                    return l10n.t({
                        message: "Filter ({0})",
                        args: [selectedTablesCount],
                        comment: ["{0} is the number of selected tables"],
                    });
                }
            },
            clearFilter: l10n.t("Clear All"),
            applyFilter: l10n.t("Apply"),
            publishChanges: l10n.t("Apply Changes"),
            openCopilotForSchemaDesigner: l10n.t("Chat"),
            openCopilotForSchemaDesignerTooltip: l10n.t("Open in GitHub Copilot Chat"),
            askGithubCopilotToFix: l10n.t("Ask GitHub Copilot to Fix"),
            askGithubCopilotToFixTooltip: l10n.t(
                "Open GitHub Copilot Chat to help fix these errors",
            ),
            schemaDesignerCopilotDiscoveryTitle: l10n.t("Design Schemas with GitHub Copilot"),
            schemaDesignerCopilotDiscoveryBody: l10n.t(
                "Ask questions or propose schema changes in chat, and GitHub Copilot updates the schema instantly in the diagram.",
            ),
            dabCopilotDiscoveryTitle: l10n.t("Build APIs with GitHub Copilot"),
            dabCopilotDiscoveryBody: l10n.t(
                "Review or propose API configuration changes in chat, and GitHub Copilot updates your configuration instantly in the Data API builder.",
            ),
            editTable: l10n.t("Edit Table"),
            openInEditor: l10n.t("Open in Editor"),
            changedTables: l10n.t("Changed Tables"),
            createAsScript: l10n.t("Create as Script"),
            details: l10n.t("Details"),
            script: l10n.t("Script"),
            newColumnMapping: l10n.t("New column mapping"),
            columnName: l10n.t("Column Name"),
            dismiss: l10n.t("Dismiss"),
            tableNameRepeatedError: (tableName: string) =>
                l10n.t({
                    message: "Table '{0}' already exists",
                    args: [tableName],
                    comment: ["{0} is the table name"],
                }),
            tableNameEmptyError: l10n.t("Table name cannot be empty"),
            tableNotFound: (tableName: string) =>
                l10n.t({
                    message: "Table '{0}' not found",
                    args: [tableName],
                    comment: ["{0} is the table name"],
                }),
            schemaDesignerNotInitialized: l10n.t("Schema designer is not initialized."),
            invalidTablePayload: l10n.t(
                "Invalid table payload. Expected table with columns array.",
            ),
            failedToAddTable: l10n.t("Failed to add table."),
            failedToUpdateTable: l10n.t("Failed to update table."),
            failedToApplySchema: l10n.t("Failed to apply schema."),
            failedToDeleteTable: l10n.t("Failed to delete table."),
            tableIdAlreadyExists: l10n.t("Table id already exists."),
            foreignKeyMappingRequired: l10n.t("Foreign key column mappings are required."),
            foreignKeyMappingLengthMismatch: l10n.t(
                "Foreign key column mappings must be the same length.",
            ),
            invalidForeignKey: l10n.t("Invalid foreign key."),
            tableMustHaveColumns: l10n.t("Table must include at least one column."),
            schemaNotAvailable: (schema: string) =>
                l10n.t({
                    message: "Schema '{0}' is not available.",
                    args: [schema],
                    comment: ["{0} is the schema name"],
                }),
            referencedTableNotFound: (tableName: string) =>
                l10n.t({
                    message: "Referenced table '{0}' not found",
                    args: [tableName],
                    comment: ["{0} is the table name"],
                }),
            columnNotFound: (columnName: string) =>
                l10n.t({
                    message: "Column '{0}' not found",
                    args: [columnName],
                    comment: ["{0} is the column name"],
                }),
            referencedColumnNotFound: (columnName: string) =>
                l10n.t({
                    message: "Referenced column '{0}' not found",
                    args: [columnName],
                    comment: ["{0} is the column name"],
                }),
            incompatibleDataTypes: (
                dataType: string,
                sourceColumn: string,
                targetDataType: string,
                targetColumn: string,
            ) =>
                l10n.t({
                    message:
                        "Data type mismatch: '{0}' in column '{1}' incompatible with '{2}' in '{3}'",
                    args: [dataType, sourceColumn, targetDataType, targetColumn],
                    comment: [
                        "{0} is source data type",
                        "{1} is source column",
                        "{2} is target data type",
                        "{3} is target column",
                    ],
                }),
            incompatibleLength: (
                sourceColumn: string,
                targetColumn: string,
                sourceLength: string,
                targetLength: string,
            ) =>
                l10n.t({
                    message: "Length mismatch: Column '{0}' ({1}) incompatible with '{2}' ({3})",
                    args: [sourceColumn, sourceLength, targetColumn, targetLength],
                    comment: [
                        "{0} is source column",
                        "{1} is source length",
                        "{2} is target column",
                        "{3} is target length",
                    ],
                }),
            incompatiblePrecisionOrScale: (sourceColumn: string, targetColumn: string) =>
                l10n.t({
                    message: "Precision/scale mismatch between '{0}' and '{1}'",
                    args: [sourceColumn, targetColumn],
                    comment: ["{0} is source column", "{1} is target column"],
                }),
            incompatibleScale: (sourceColumn: string, targetColumn: string) =>
                l10n.t({
                    message: "Scale mismatch between '{0}' and '{1}'",
                    args: [sourceColumn, targetColumn],
                    comment: ["{0} is source column", "{1} is target column"],
                }),
            referencedColumnNotPK: (targetColumn: string) =>
                l10n.t({
                    message: "Column '{0}' must be a primary key",
                    args: [targetColumn],
                    comment: ["{0} is the referenced column"],
                }),
            cyclicForeignKeyDetected: (tableName: string, targetTable: string) =>
                l10n.t({
                    message: "Circular reference detected: '{0}' → '{1}' creates a cycle",
                    args: [tableName, targetTable],
                    comment: ["{0} is source table", "{1} is target table"],
                }),
            foreignKeyError: l10n.t("Cannot create foreign key"),
            duplicateForeignKeyColumns: (columnName: string) =>
                l10n.t({
                    message: "Column '{0}' already has a foreign key",
                    args: [columnName],
                    comment: ["{0} is the column name"],
                }),
            foreignKeyNameEmptyWarning: l10n.t("Consider adding a name for this foreign key"),
            foreignKeyNameRepeatedError: (foreignKeyName: string) =>
                l10n.t({
                    message: "Foreign key '{0}' already exists",
                    args: [foreignKeyName],
                    comment: ["{0} is the foreign key name"],
                }),
            tableNodeSubText: (colCount: number) =>
                l10n.t({
                    message: "{0} column data",
                    args: [colCount],
                    comment: ["{0} is the number of columns"],
                }),
            identityColumnFKConstraint: (columnName: string) =>
                l10n.t({
                    message:
                        "Column '{0}' is an identity column and cannot have a cascading foreign key",
                    args: [columnName],
                    comment: ["{0} is the column name"],
                }),
            manageRelationships: l10n.t("Manage relationships"),
            noChangesDetected: l10n.t("No changes detected"),
            allowNull: l10n.t("Allow Null"),
            maxLength: l10n.t("Max Length"),
            isIdentity: l10n.t("Is Identity"),
            scale: l10n.t("Scale"),
            precision: l10n.t("Precision"),
            defaultValue: l10n.t("Default Value"),
            isComputed: l10n.t("Is Computed"),
            computedFormula: l10n.t("Formula"),
            isPersisted: l10n.t("Is Persisted"),
            svg: l10n.t("SVG"),
            png: l10n.t("PNG"),
            jpeg: l10n.t("JPEG"),
            columnNameRepeatedError: (columnName: string) =>
                l10n.t({
                    message: "Column '{0}' already exists",
                    args: [columnName],
                    comment: ["{0} is the column name"],
                }),
            columnNameEmptyError: l10n.t("Column name cannot be empty"),
            columnPKCannotBeNull: (columnName: string) =>
                l10n.t({
                    message: "Column '{0}' cannot be null because it is a primary key",
                    args: [columnName],
                    comment: ["{0} is the column name"],
                }),
            columnMaxLengthEmptyError: l10n.t("Column max length cannot be empty"),
            columnMaxLengthInvalid: (maxLength: string) =>
                l10n.t({
                    message: "Invalid max length '{0}'",
                    args: [maxLength],
                    comment: ["{0} is the max length"],
                }),
            loadingSchemaDesigner: l10n.t("Loading Schema Designer"),
            errorLoadingSchemaDesigner: l10n.t("Error loading Schema Designer"),
            retry: l10n.t("Retry"),
            generatingReport: l10n.t("Generating report, this might take a while..."),
            nWarnings: (warningCount: number) =>
                l10n.t({
                    message: "{0} warnings",
                    args: [warningCount],
                    comment: ["{0} is the number of warnings"],
                }),
            nErrors: (errorCount: number) =>
                l10n.t({
                    message: "{0} errors",
                    args: [errorCount],
                    comment: ["{0} is the number of errors"],
                }),
            openPublishScript: l10n.t("Open Publish Script"),
            Close: l10n.t("Close"),
            publish: l10n.t("Publish"),
            publishingChanges: l10n.t("Publishing Changes"),
            changesPublishedSuccessfully: l10n.t("Changes published successfully"),
            continueEditing: l10n.t("Continue Editing"),
            onUpdate: l10n.t("On Update"),
            onDelete: l10n.t("On Delete"),
            cascade: l10n.t("Cascade"),
            setNull: l10n.t("Set Null"),
            setDefault: l10n.t("Set Default"),
            noAction: l10n.t("No Action"),
            possibleDataLoss: l10n.t("Possible Data Loss detected. Please review the changes."),
            hasWarnings: l10n.t("Warnings detected. Please review the changes."),
            definition: l10n.t("Definition"),
            showDefinition: l10n.t("Show Definition"),
            hideDefinition: l10n.t("Hide Definition"),
            definitionType: l10n.t("Definition type"),
            definitionTypeSql: l10n.t("T-SQL"),
            definitionTypePrisma: l10n.t("Prisma"),
            definitionTypeSequelize: l10n.t("Sequelize"),
            definitionTypeTypeOrm: l10n.t("TypeORM"),
            definitionTypeDrizzle: l10n.t("Drizzle"),
            definitionTypeSqlAlchemy: l10n.t("SQLAlchemy"),
            definitionTypeEfCore: l10n.t("EF Core"),
            addToWorkspace: l10n.t("Add to workspace"),
            copy: l10n.t("Copy"),
            close: l10n.t("Close"),
            deleteConfirmation: l10n.t("Delete Confirmation"),
            deleteConfirmationContent: l10n.t(
                "Are you sure you want to delete the selected items?",
            ),
            undo: l10n.t("Undo"),
            redo: l10n.t("Redo"),
            searchTables: l10n.t("Search tables..."),
            showTableRelationships: l10n.t("Show table relationships"),
            schemaDesignerNavLabel: l10n.t("Visualize and Design Schema"),
            dabNavLabel: l10n.t("Build Data API"),
            showChangesButtonLabel: l10n.t("Show Changes"),
            hideChangesButtonLabel: l10n.t("Hide Changes"),
            showCopilotChangesButtonLabel: l10n.t("Copilot Changes"),
            highlightChanges: l10n.t("Highlight Changes"),
            hideChangesHighlight: l10n.t("Hide Changes Highlight"),
            changesPanelTitle: (changeCount: number) =>
                l10n.t({
                    message: "Changes ({0})",
                    args: [changeCount],
                    comment: ["{0} is the number of schema changes"],
                }),
            copilotChangesPanelTitle: (changeCount: number) =>
                l10n.t({
                    message: "Copilot Changes ({0})",
                    args: [changeCount],
                    comment: ["{0} is the number of copilot changes"],
                }),
            noChangesYet: l10n.t("No changes yet."),
            noChangesYetSubtitle: l10n.t("Edit your schema to see changes here."),
            schemaChangeInTable: (qualifiedTableName: string, changeDescription: string) =>
                l10n.t({
                    message: "{0}: {1}",
                    args: [qualifiedTableName, changeDescription],
                    comment: ["{0} is the qualified table name", "{1} is the change description"],
                }),

            schemaDiff: {
                undefinedValue: l10n.t("undefined"),
                propertyChanged: (
                    propertyDisplayName: string,
                    oldValue: string,
                    newValue: string,
                ) =>
                    l10n.t({
                        message: "{0} changed from '{1}' to '{2}'",
                        args: [propertyDisplayName, oldValue, newValue],
                        comment: [
                            "{0} is the display name of the property",
                            "{1} is the old value",
                            "{2} is the new value",
                        ],
                    }),

                createdTable: (qualifiedTableName: string) =>
                    l10n.t({
                        message: "Created table {0}",
                        args: [qualifiedTableName],
                        comment: ["{0} is the qualified table name"],
                    }),
                deletedTable: (qualifiedTableName: string) =>
                    l10n.t({
                        message: "Deleted table {0}",
                        args: [qualifiedTableName],
                        comment: ["{0} is the qualified table name"],
                    }),
                modifiedTable: (qualifiedTableName: string) =>
                    l10n.t({
                        message: "Modified table {0}",
                        args: [qualifiedTableName],
                        comment: ["{0} is the qualified table name"],
                    }),
                modifiedTableWithChanges: (qualifiedTableName: string, propertyChanges: string) =>
                    l10n.t({
                        message: "Modified table {0}: {1}",
                        args: [qualifiedTableName, propertyChanges],
                        comment: [
                            "{0} is the qualified table name",
                            "{1} is a list of property changes",
                        ],
                    }),

                addedColumn: (columnName: string) =>
                    l10n.t({
                        message: "Added column '{0}'",
                        args: [columnName],
                        comment: ["{0} is the column name"],
                    }),
                deletedColumn: (columnName: string) =>
                    l10n.t({
                        message: "Deleted column '{0}'",
                        args: [columnName],
                        comment: ["{0} is the column name"],
                    }),
                modifiedColumn: (columnName: string) =>
                    l10n.t({
                        message: "Modified column '{0}'",
                        args: [columnName],
                        comment: ["{0} is the column name"],
                    }),
                modifiedColumnWithChanges: (columnName: string, propertyChanges: string) =>
                    l10n.t({
                        message: "Modified column '{0}': {1}",
                        args: [columnName, propertyChanges],
                        comment: ["{0} is the column name", "{1} is a list of property changes"],
                    }),

                addedForeignKey: (foreignKeyName: string) =>
                    l10n.t({
                        message: "Added foreign key '{0}'",
                        args: [foreignKeyName],
                        comment: ["{0} is the foreign key name"],
                    }),
                deletedForeignKey: (foreignKeyName: string) =>
                    l10n.t({
                        message: "Deleted foreign key '{0}'",
                        args: [foreignKeyName],
                        comment: ["{0} is the foreign key name"],
                    }),
                modifiedForeignKey: (foreignKeyName: string) =>
                    l10n.t({
                        message: "Modified foreign key '{0}'",
                        args: [foreignKeyName],
                        comment: ["{0} is the foreign key name"],
                    }),
                modifiedForeignKeyWithChanges: (foreignKeyName: string, propertyChanges: string) =>
                    l10n.t({
                        message: "Modified foreign key '{0}': {1}",
                        args: [foreignKeyName, propertyChanges],
                        comment: [
                            "{0} is the foreign key name",
                            "{1} is a list of property changes",
                        ],
                    }),
            },

            // Changes panel
            changesPanel: {
                // Change type labels
                added: l10n.t("Added"),
                modified: l10n.t("Modified"),
                deleted: l10n.t("Deleted"),

                // Filter tags
                filterAll: l10n.t("All"),
                filterAdded: l10n.t("Added"),
                filterModified: l10n.t("Modified"),
                filterDeleted: l10n.t("Deleted"),
                filterTooltip: l10n.t("Filter changes"),
                filterPanelTitle: l10n.t("Filter Changes"),
                actionTypeLabel: l10n.t("Action Type"),
                objectTypeLabel: l10n.t("Object Type"),
                actionFilterLabel: l10n.t("Action"),
                categoryFilterLabel: l10n.t("Category"),
                clearFilters: l10n.t("Clear all"),
                clearFiltersButton: l10n.t("Clear Filters"),
                applyFilters: l10n.t("Apply"),
                changeCountLabel: (changeCount: number) =>
                    l10n.t({
                        message: "{0} changes",
                        args: [changeCount],
                        comment: ["{0} is the number of property changes"],
                    }),
                propertyHeader: l10n.t("Property"),
                beforeHeader: l10n.t("Before"),
                afterHeader: l10n.t("After"),
                noPropertyChanges: l10n.t("No property changes available."),
                emptyValue: l10n.t("(empty)"),

                // Buttons
                reveal: l10n.t("Reveal"),
                revert: l10n.t("Revert"),

                // Search
                searchPlaceholder: l10n.t("Search changes..."),
                noSearchResults: l10n.t("No changes match your search."),

                // View mode segmented control
                viewModeAriaLabel: l10n.t("Changes view mode"),
                viewModeSchemaChanges: l10n.t("Schema Changes"),
                viewModeSchemaDiff: l10n.t("Schema Diff"),

                // Tooltips
                revealTooltip: l10n.t("Navigate to this item in the diagram"),
                revertTooltip: l10n.t("Revert this change to its original state"),
                cannotRevertForeignKey: l10n.t(
                    "Cannot revert: The referenced table or column has been deleted",
                ),
                cannotRevertDeletedColumn: l10n.t(
                    "Cannot revert: The column is part of a foreign key that references a deleted table",
                ),

                // Categories
                tableCategory: l10n.t("Table"),
                columnCategory: l10n.t("Column"),
                foreignKeyCategory: l10n.t("Foreign Key"),

                // Item count
                itemCount: (count: number) =>
                    l10n.t({
                        message: "{0} change(s)",
                        args: [count],
                        comment: ["{0} is the number of changes"],
                    }),
            },
            accept: l10n.t("Accept"),
            acceptAll: l10n.t("Accept All"),
            undoAll: l10n.t("Undo All"),
            undoAllConfirmation: l10n.t("Undo All Copilot Changes"),
            undoAllConfirmationContent: l10n.t(
                "Are you sure you want to undo all copilot changes? This will revert all tracked changes to their original state.",
            ),
            reject: l10n.t("Reject"),
            reviewingCopilotChange: l10n.t("Reviewing Copilot Change"),
            changeNofM: (current: number, total: number) =>
                l10n.t({
                    message: "Change {0} of {1}",
                    args: [current, total],
                    comment: [
                        "{0} is the current change number",
                        "{1} is the total number of changes",
                    ],
                }),
            copilotUnknown: l10n.t("Unknown"),
            copilotOnDelete: l10n.t("On Delete"),
            copilotOnUpdate: l10n.t("On Update"),
            copilotReferencedSchema: l10n.t("Referenced schema"),
            copilotReferencedTable: l10n.t("Referenced table"),
            copilotReferencedColumns: l10n.t("Referenced columns"),
            copilotForeignKeys: l10n.t("Foreign keys"),
            copilotDataType: l10n.t("Data type"),
            copilotPrimaryKey: l10n.t("Primary key"),
            copilotAllowNull: l10n.t("Allow null"),
            copilotPropertySummaryMore: (firstProperty: string, additionalCount: number) =>
                l10n.t({
                    message: "{0}, +{1} more",
                    args: [firstProperty, additionalCount],
                    comment: [
                        "{0} is the first changed property label",
                        "{1} is the count of additional changed properties",
                    ],
                }),

            // DAB (Data API builder) strings
            dabTitle: l10n.t("Data API builder Configuration"),
            apiType: l10n.t("API Type"),
            restApi: l10n.t("REST API"),
            graphql: l10n.t("GraphQL"),
            mcp: l10n.t("MCP"),
            enableRestForEntity: l10n.t("Expose this entity through REST"),
            enableRestForEntityHelp: l10n.t(
                "Enable REST in API Type to expose this entity through REST.",
            ),
            enableGraphQLForEntity: l10n.t("Expose this entity through GraphQL"),
            enableGraphQLForEntityHelp: l10n.t(
                "Enable GraphQL in API Type to expose this entity through GraphQL.",
            ),
            storedProcedureRestMethods: l10n.t("Stored procedure REST methods"),
            storedProcedureRestMethodsHelp: l10n.t(
                "Select the HTTP method that can execute this stored procedure. DAB defaults to POST.",
            ),
            storedProcedureGraphQLOperation: l10n.t("Stored procedure GraphQL operation"),
            storedProcedureGraphQLOperationHelp: l10n.t(
                "Choose whether this stored procedure appears as a GraphQL mutation or query. DAB defaults to mutation.",
            ),
            graphqlMutation: l10n.t("Mutation"),
            graphqlQuery: l10n.t("Query"),
            mcpCustomTool: l10n.t("MCP custom tool"),
            exposeAsMcpCustomTool: l10n.t("Expose as MCP custom tool"),
            exposeAsMcpCustomToolHelp: l10n.t(
                "Creates a dedicated MCP tool for this stored procedure. When disabled, the procedure can still be available through generic MCP execute tools if MCP is enabled.",
            ),
            exposeAsMcpDmlTools: l10n.t("Expose as MCP DML tools"),
            exposeAsMcpDmlToolsHelp: l10n.t(
                "Allows MCP clients to use generic create, read, update, and delete tools for this table.",
            ),
            enableMcpForDmlToolsHelp: l10n.t(
                "Enable MCP in API Type to use this DML tools setting.",
            ),
            enableMcpForCustomToolHelp: l10n.t(
                "Enable MCP in API Type to use this custom tool setting.",
            ),
            apiTypeNotEnabledGlobally: (apiType: string) =>
                l10n.t({
                    message: "{0} is not enabled globally",
                    args: [apiType],
                    comment: ["{0} is the API type, e.g. REST, GraphQL, or MCP"],
                }),
            enableApiTypeForEntity: (apiType: string) =>
                l10n.t({
                    message: "Enable {0} in API Type to expose this entity.",
                    args: [apiType],
                    comment: ["{0} is the API type, e.g. REST, GraphQL, or MCP"],
                }),
            enableApiTypeGlobally: (apiType: string) =>
                l10n.t({
                    message: "Enable {0} globally",
                    args: [apiType],
                    comment: ["{0} is the API type, e.g. REST, GraphQL, or MCP"],
                }),
            all: l10n.t("All"),
            entityEndpoints: l10n.t("Entity Endpoints"),
            allSchemas: l10n.t("All Schemas"),
            filterEntities: l10n.t("Filter entities..."),
            filterEntitiesTitle: l10n.t("Filter entities"),
            status: l10n.t("Status"),
            objectType: l10n.t("Object type"),
            clearAllFilters: l10n.t("Clear all"),
            entityStatusFilterLabel: (status: "all" | "enabled" | "disabled" | "warnings") => {
                switch (status) {
                    case "enabled":
                        return l10n.t("Enabled");
                    case "disabled":
                        return l10n.t("Disabled");
                    case "warnings":
                        return l10n.t("Warnings");
                    case "all":
                        return l10n.t("All");
                }
            },
            nOfMEnabled: (enabled: number, total: number) =>
                l10n.t({
                    message: "{0} of {1} enabled",
                    args: [enabled, total],
                    comment: [
                        "{0} is the number of enabled entities",
                        "{1} is the total number of entities",
                    ],
                }),
            create: l10n.t("Create"),
            read: l10n.t("Read"),
            update: l10n.t("Update"),
            execute: l10n.t("Execute"),
            view: l10n.t("View"),
            storedProcedure: l10n.t("Stored Procedure"),
            tables: l10n.t("Tables"),
            views: l10n.t("Views"),
            storedProcedures: l10n.t("Stored Procedures"),
            invalidEntityReference: l10n.t(
                "Invalid entity reference. Use either id OR schemaName+tableName OR schemaName+sourceName+sourceType.",
            ),
            invalidColumnReference: l10n.t("Invalid column reference. Use either id OR name."),
            entityNotFound: (entityRef: string) =>
                l10n.t({
                    message: "Entity not found: {0}",
                    args: [entityRef],
                    comment: ["{0} is the entity reference"],
                }),
            entityReferenceNotUnique: (entityRef: string) =>
                l10n.t({
                    message: "Entity reference resolved to more than one entity: {0}",
                    args: [entityRef],
                    comment: ["{0} is the entity reference"],
                }),
            dabColumnNotFound: (columnRef: string) =>
                l10n.t({
                    message: "Column not found: {0}",
                    args: [columnRef],
                    comment: ["{0} is the column reference"],
                }),
            columnReferenceNotUnique: (columnRef: string) =>
                l10n.t({
                    message: "Column reference resolved to more than one column: {0}",
                    args: [columnRef],
                    comment: ["{0} is the column reference"],
                }),
            unsupportedByDataApiBuilder: l10n.t("Unsupported by Data API builder."),
            entityNotSupportedByDataApiBuilder: (entityName: string, reason: string) =>
                l10n.t({
                    message: "Entity '{0}' is not supported by Data API builder. {1}",
                    args: [entityName, reason],
                    comment: ["{0} is the entity name", "{1} is why the entity is unsupported"],
                }),
            bulkActions: l10n.t("Bulk Actions"),
            enableAllEntities: l10n.t("Enable all entities"),
            disableAllEntities: l10n.t("Disable all entities"),
            makeReadOnly: l10n.t("Make everything read-only"),
            enableAllCruds: l10n.t("Enable all CRUD operations"),
            includeAllColumns: l10n.t("Include all columns"),
            entityNameDescription: l10n.t("Entity name used in API routes"),
            viewConfig: l10n.t("View Config"),
            deploy: l10n.t("Deploy"),
            dabDeploymentNotSupported: l10n.t(
                "Local container deployment is currently only supported with SQL Authentication connections.",
            ),
            atLeastOneApiTypeRequired: l10n.t("At least one API type must be selected."),
            authenticationNotSupported: l10n.t("Authentication not supported"),
            dabDeploymentNotSupportedBanner: l10n.t(
                "In the Data API builder experience, local container deployment is only available for connections using SQL Authentication. Your current connection type is not supported.",
            ),
            unsupportedDataTypesDetected: l10n.t("Unsupported data types detected"),
            dabUnsupportedDataTypesBanner: l10n.t(
                "One or more of your entities contain column types that are not currently supported by Data API builder. These entities cannot be selected for deployment.",
            ),
            backToSchema: l10n.t("Back to Schema"),
            designApi: l10n.t("Design API"),
            // DAB Advanced Settings Dialog
            advancedEntityConfiguration: l10n.t("Advanced Entity Configuration"),
            identity: l10n.t("Identity"),
            rest: l10n.t("REST"),
            entityName: l10n.t("Entity Name"),
            entityNameHelp: l10n.t("Used in API routes and responses"),
            authorizationRole: l10n.t("Permissions"),
            authorizationRoleHelp: l10n.t("Define who can access this endpoint"),
            authorizationRoleStoredProcedureHelp: l10n.t(
                "Define who can execute this stored procedure",
            ),
            disabledGlobally: l10n.t("Disabled globally"),
            anonymous: l10n.t("Anonymous"),
            anonymousDescription: l10n.t("No authentication required"),
            authenticated: l10n.t("Authenticated"),
            authenticatedDescription: l10n.t("Requires user authentication"),
            customRestPath: l10n.t("Custom REST Path"),
            customRestPathHelp: l10n.t("Optional - Override default api/entityName path"),
            customGraphQLType: l10n.t("Custom GraphQL Type"),
            customGraphQLSingularType: l10n.t("Custom GraphQL Singular Type"),
            customGraphQLSingularTypeHelp: l10n.t(
                "Optional - Override default GraphQL singular type name",
            ),
            customGraphQLPluralType: l10n.t("Custom GraphQL Plural Type"),
            customGraphQLPluralTypeHelp: l10n.t(
                "Optional - Override default GraphQL plural type name",
            ),
            applyChanges: l10n.t("Apply Changes"),
            source: l10n.t("Source"),
            sourceWithName: (sourceName: string) =>
                l10n.t({
                    message: "Source: {0}",
                    args: [sourceName],
                    comment: ["{0} is the fully qualified DAB source object name"],
                }),
            loading: l10n.t("Loading..."),
            initializingDabConfig: l10n.t("Initializing DAB configuration..."),
            noEntitiesFound: l10n.t("No entities found"),
            selectAllEntities: l10n.t("Select all entities"),
            toggleAllEntitiesInSchema: (schemaName: string) =>
                l10n.t({
                    message: "Toggle all entities in {0}",
                    args: [schemaName],
                    comment: ["{0} is the schema name"],
                }),
            enableEntity: (entityName: string) =>
                l10n.t({
                    message: "Enable {0}",
                    args: [entityName],
                    comment: ["{0} is the entity name"],
                }),
            toggleEntityColumns: (entityName: string) =>
                l10n.t({
                    message: "Toggle columns for {0}",
                    args: [entityName],
                    comment: ["{0} is the entity name"],
                }),
            exposeColumn: (columnName: string) =>
                l10n.t({
                    message: "Expose {0}",
                    args: [columnName],
                    comment: ["{0} is the backing database column name"],
                }),
            primaryKeyColumnExposureLocked: (columnName: string) =>
                l10n.t({
                    message: "{0} is a primary key column and can't be disabled.",
                    args: [columnName],
                    comment: ["{0} is the backing database column name"],
                }),
            actionForEntity: (action: string, entityName: string) =>
                l10n.t({
                    message: "{0} action for {1}",
                    args: [action, entityName],
                    comment: [
                        "{0} is the action name (Create, Read, etc.)",
                        "{1} is the entity name",
                    ],
                }),
            settingsForEntity: (entityName: string) =>
                l10n.t({
                    message: "Settings for {0}",
                    args: [entityName],
                    comment: ["{0} is the entity name"],
                }),
            selectAllAction: (action: string) =>
                l10n.t({
                    message: "Select all {0}",
                    args: [action],
                    comment: ["{0} is the action name (Create, Read, etc.)"],
                }),

            // DAB Deployment Dialog
            deployDabContainer: l10n.t("Deploy DAB Container"),
            localContainerDeployment: l10n.t("Local Container Deployment"),
            deployDabContainerDescription: (apiTypes: string) =>
                l10n.t({
                    message:
                        "This will deploy a Data API builder container locally using Docker. The container will expose {0} APIs based on your configuration.",
                    args: [apiTypes],
                    comment: ["{0} is a list of API types, e.g. 'REST and GraphQL'"],
                }),
            requirements: l10n.t("Requirements:"),
            dockerDesktopRequirement: l10n.t(
                "Docker Desktop must be installed and running on your machine.",
            ),
            containerSettings: l10n.t("Container Settings"),
            containerName: l10n.t("Container Name"),
            containerNameRequired: l10n.t("Container name is required"),
            containerNameInvalid: l10n.t(
                "Must start with an alphanumeric character and contain only alphanumeric characters, underscores, periods, or hyphens",
            ),
            containerNameHint: l10n.t("Name for the Docker container running DAB"),
            port: l10n.t("Port"),
            portInvalid: l10n.t("Port must be between 1 and 65535"),
            portHint: l10n.t("Port to expose the API on (default: 5000)"),
            deploymentComplete: l10n.t("Deployment Complete"),
            deploymentFailed: l10n.t("Deployment Failed"),
            dabContainerRunning: l10n.t("DAB container is running!"),
            apiAvailableAt: l10n.t("Your API is available at:"),
            apisAvailableAt: l10n.t("Your APIs are available at the following endpoints:"),
            copyUrl: (apiType: string) =>
                l10n.t({
                    message: "Copy {0} URL",
                    args: [apiType],
                    comment: ["{0} is the API type name, e.g. REST API or GraphQL"],
                }),
            addToVSCode: l10n.t("Add to VS Code"),
            addMcpServerToWorkspace: l10n.t("Add MCP server to workspace configuration"),
            mcpServerAdded: l10n.t("Added"),
            viewSwagger: l10n.t("View Swagger"),
            openNitro: l10n.t("Open Nitro"),

            // DAB Unsupported Reasons
            unsupportedNoPrimaryKey: (sourceType: string = "Table") =>
                l10n.t({
                    message:
                        "{0} must define one or more key fields to be used with Data API builder",
                    args: [sourceType],
                    comment: ["{0} is the DAB source type, e.g. Table or View"],
                }),
            unsupportedDataTypes: (columns: string, sourceType: string = "Table") =>
                l10n.t({
                    message: "{0} contains column types not supported by Data API builder: {1}",
                    args: [sourceType, columns],
                    comment: [
                        "{0} is the DAB source type, e.g. Table or View",
                        "{1} is a comma-separated list of column names and their data types",
                    ],
                }),

            // DAB Deployment Steps
            checkingDockerInstallation: l10n.t("Checking Docker installation"),
            verifyingDockerInstalled: l10n.t("Verifying Docker is installed on your system"),
            startingDockerDesktop: l10n.t("Starting Docker Desktop"),
            ensuringDockerDesktopRunning: l10n.t("Ensuring Docker Desktop is running"),
            checkingDockerEngine: l10n.t("Checking Docker engine"),
            verifyingDockerEngineReady: l10n.t("Verifying Docker engine is ready"),
            pullingDabImage: l10n.t("Pulling DAB container image"),
            downloadingDabImage: l10n.t("Downloading the Data API builder container image"),
            startingDabContainer: l10n.t("Starting DAB container"),
            creatingAndStartingContainer: l10n.t("Creating and starting the container"),
            checkingContainerReadiness: l10n.t("Checking container readiness"),
            verifyingApiReady: l10n.t("Verifying the API is ready to accept requests"),
            containerLogs: l10n.t("Container logs"),
        };
    }

    public get schemaCompare() {
        return {
            intro: l10n.t(
                "To compare two schemas, first select a source schema and target schema, then press compare.",
            ),
            selectSourceSchema: l10n.t("Select Source Schema"),
            selectTargetSchema: l10n.t("Select Target Schema"),
            addServerConnection: l10n.t("Add Server Connection"),
            noDifferences: l10n.t("No schema differences were found."),
            initializingComparison: l10n.t("Initializing comparison, this might take a while..."),
            applyingChanges: l10n.t("Applying changes, this might take a while..."),
            applySucceededRunAgain: l10n.t(
                "Changes applied successfully. Run Schema Compare again to see updated differences.",
            ),
            applyFailedRunAgain: l10n.t(
                "Apply failed. Fix the error and retry, or run Schema Compare again.",
            ),
            server: l10n.t("Server"),
            database: l10n.t("Database"),
            defaultUserName: l10n.t("default"),
            folderStructure: l10n.t("Folder Structure"),
            file: l10n.t("File"),
            flat: l10n.t("Flat"),
            objectType: l10n.t("Object Type"),
            schema: l10n.t("Schema"),
            schemaObjectType: l10n.t("Schema/Object Type"),
            description: l10n.t("Description"),
            settings: l10n.t("Settings"),
            compare: l10n.t("Compare"),
            schemaCompareOptions: l10n.t("Schema Compare Options"),
            searchOptions: l10n.t("Search options..."),
            generalOptions: l10n.t("General Options"),
            includeObjectTypes: l10n.t("Include Object Types"),
            selectAllOptions: l10n.t("Select all options"),
            includeAllObjectTypes: l10n.t("Include all object types"),
            optionDescription: l10n.t("Option Description"),
            reset: l10n.t("Reset"),
            stop: l10n.t("Stop"),
            generateScript: l10n.t("Generate Script"),
            generateScriptToDeployChangesToTarget: l10n.t(
                "Generate script to deploy changes to target",
            ),
            apply: l10n.t("Apply"),
            applyChangesToTarget: l10n.t("Apply changes to target"),
            options: l10n.t("Options"),
            switchDirection: l10n.t("Switch Direction"),
            switchSourceAndTarget: l10n.t("Switch Source and Target"),
            openScmpFile: l10n.t("Open .scmp file"),
            loadSourceTargetAndOptionsSavedInAnScmpFile: l10n.t(
                "Load source, target, and options saved in an .scmp file",
            ),
            saveScmpFile: l10n.t("Save .scmp file"),
            saveSourceAndTargetOptionsAndExcludedElements: l10n.t(
                "Save source and target, options, and excluded elements",
            ),
            groupDifferencesBy: l10n.t("Group differences by"),
            type: l10n.t("Type"),
            sourceName: l10n.t("Source Name"),
            include: l10n.t("Include"),
            action: l10n.t("Action"),
            targetName: l10n.t("Target Name"),
            add: l10n.t("Add"),
            change: l10n.t("Change"),
            delete: l10n.t("Delete"),
            selectSource: l10n.t("Select Source"),
            selectTarget: l10n.t("Select Target"),
            close: l10n.t("Close"),
            dacpacDialogFile: l10n.t("Data-tier Application File (.dacpac)"),
            databaseProject: l10n.t("Database Project"),
            ok: l10n.t("OK"),
            cancel: l10n.t("Cancel"),
            source: l10n.t("Source"),
            target: l10n.t("Target"),
            compareDetails: l10n.t("Comparison Details"),
            areYouSureYouWantToUpdateTheTarget: l10n.t(
                "Are you sure you want to update the target?",
            ),
            thereWasAnErrorUpdatingTheProject: l10n.t("There was an error updating the project"),
            schemaCompareApplyFailed: (errorMessage: string) =>
                l10n.t({
                    message: "Failed to apply changes: '{0}'",
                    args: [errorMessage ? errorMessage : "Unknown"],
                    comment: [
                        "{0} is the error message returned from the publish changes operation",
                    ],
                }),
            openScmpErrorMessage: (errorMessage: string) =>
                l10n.t({
                    message: "Failed to open scmp file: '{0}'",
                    args: [errorMessage ? errorMessage : "Unknown"],
                    comment: ["{0} is the error message returned from the open scmp operation"],
                }),
            saveScmpErrorMessage: (errorMessage: string) =>
                l10n.t({
                    message: "Failed to save scmp file: '{0}'",
                    args: [errorMessage ? errorMessage : "Unknown"],
                    comment: ["{0} is the error message returned from the save scmp operation"],
                }),
            cannotExcludeEntryWithBlockingDependency: (
                diffEntryName: string,
                firstDependentName: string,
            ) =>
                l10n.t({
                    message: "Cannot exclude {0}. Included dependents exist, such as {1}",
                    args: [diffEntryName, firstDependentName],
                    comment: [
                        "{0} is the name of the entry",
                        "{1} is the name of the blocking dependency preventing exclusion.",
                    ],
                }),
            cannotIncludeEntryWithBlockingDependency: (
                diffEntryName: string,
                firstDependentName: string,
            ) =>
                l10n.t({
                    message: "Cannot include {0}. Excluded dependents exist, such as {1}",
                    args: [diffEntryName, firstDependentName],
                    comment: [
                        "{0} is the name of the entry",
                        "{1} is the name of the blocking dependency preventing inclusion.",
                    ],
                }),
            cannotExcludeEntry: (diffEntryName: string) =>
                l10n.t({
                    message: "Cannot exclude {0}. Included dependents exist",
                    args: [diffEntryName],
                    comment: ["{0} is the name of the entry"],
                }),
            cannotIncludeEntry: (diffEntryName: string) =>
                l10n.t({
                    message: "Cannot include {0}. Excluded dependents exist",
                    args: [diffEntryName],
                    comment: ["{0} is the name of the entry"],
                }),
            includeExcludeAllOperationInProgress: l10n.t(
                "Processing include or exclude all differences operation.",
            ),
        };
    }

    public get publishProject() {
        return {
            publishProject: l10n.t("Publish Project"),
            publishProjectTitle: (projectName: string) =>
                l10n.t({
                    message: "Publish Project - {0}",
                    args: [projectName],
                    comment: ["{0} is the name of the project being published"],
                }),
            SelectPublishProfile: l10n.t("Select Profile"),
            SaveAs: l10n.t("Save As..."),
            generateScript: l10n.t("Generate Script"),
            publish: l10n.t("Publish"),
            advancedOptions: l10n.t("Advanced"),
            advancedPublishSettings: l10n.t("Advanced Publish Options"),
            generalOptions: l10n.t("General Options"),
            ignoreOptions: l10n.t("Ignore Options"),
            excludeObjectTypes: l10n.t("Exclude Object Types"),
            SqlCmdVariablesLabel: l10n.t("SQLCMD Variables"),
            SqlCmdVariableNameColumn: l10n.t("Name"),
            SqlCmdVariableValueColumn: l10n.t("Value"),
            RevertSqlCmdVariablesToDefaults: l10n.t("Revert values to project defaults"),
            SqlPackageCommand: l10n.t("SqlPackage Command"),
            GenerateSqlPackageCommand: l10n.t("Generate sqlpackage command"),
            SqlPackageCommandTitle: l10n.t("SqlPackage Command"),
            copySqlPackageCommandToClipboard: l10n.t("Copy command to clipboard"),
            showUnmaskedCommand: l10n.t("Show unmasked command (reveals sensitive information)"),
            showMaskedCommand: l10n.t("Show masked command (hides sensitive information)"),
        };
    }

    public get connectionGroups() {
        return {
            createNew: l10n.t("Create New Connection Group"),
            editConnectionGroup: (groupName: string) =>
                l10n.t({
                    message: "Edit Connection Group: {0}",
                    args: [groupName],
                    comment: ["{0} is the name of the connection group being edited"],
                }),
            name: l10n.t("Name"),
            enterConnectionGroupName: l10n.t("Enter connection group name"),
            description: l10n.t("Description"),
            enterDescription: l10n.t("Enter description (optional)"),
            color: l10n.t("Color"),
            chooseColor: l10n.t("Choose color"),
            saveConnectionGroup: l10n.t("Save Connection Group"),
            hue: l10n.t("Hue"),
            saturation: l10n.t("Saturation"),
            brightness: l10n.t("Brightness"),
        };
    }

    public get deployment() {
        return {
            loadingDeploymentPage: l10n.t("Loading deployment"),
            deploymentHeader: l10n.t("New SQL database"),
            deploymentDescription: l10n.t("Choose an option to provision a database"),
            sqlServerContainerHeader: l10n.t("Local SQL Server database container"),
            dockerSqlServerHeader: l10n.t("Create a Local Docker SQL Server"),
            dockerSqlServerDescription: l10n.t(
                "Easily set up a local SQL Server without leaving VS Code extension. Just a few clicks to install, configure, and manage your server effortlessly!",
            ),
            fabricProvisioningHeader: l10n.t("Create a SQL database in Fabric"),
            fabricProvisioningDescription: l10n.t(
                "A highly integrated, developer-ready transactional database that auto-scales, auto-tunes, and mirrors data to OneLake for analytics across Fabric services",
            ),
        };
    }

    public get localContainers() {
        return {
            loadingLocalContainers: l10n.t("Loading local containers..."),
            sqlServerContainerHeader: l10n.t("Local SQL Server database container"),
            instantContainerSetup: l10n.t("Instant Container Setup"),
            instantContainerDescription: l10n.t(
                "Create a SQL Server container in seconds—no manual steps required. Manage it easily from the MSSQL extension without leaving VS Code.",
            ),
            simpleManagement: l10n.t("Simple Container Management"),
            simpleManagementDescription: l10n.t(
                "Start, stop, and remove containers directly from the extension.",
            ),
            chooseTheRightVersion: l10n.t("Choose the Right Version"),
            chooseTheRightVersionDescription: l10n.t(
                "Pick from multiple SQL Server versions, including SQL Server 2025 with built-in AI capabilities like vector search and JSON enhancements.",
            ),
            learnMoreAboutSqlServer2025: l10n.t("Learn more about SQL Server 2025 features"),
            sqlServerEditionsComparison: l10n.t("Compare SQL Server editions"),
            configureAndCustomizeSqlServer: l10n.t("Configure and customize SQL Server containers"),
            verifyContainerImageNotationCli: l10n.t(
                "Verify a container image by using the Notation CLI",
            ),
            gettingDockerReady: l10n.t("Getting Docker Ready..."),
            checkingPrerequisites: l10n.t("Checking pre-requisites"),
            createContainer: l10n.t("Create Container"),
            settingUp: l10n.t("Setting up"),
            gettingContainerReadyForConnection: l10n.t("Getting container ready for connections"),
            hideFullErrorMessage: l10n.t("Hide full error message"),
            showFullErrorMessage: l10n.t("Show full error message"),
            previousStepFailed: l10n.t(
                "Previous step failed. Please check the error message and try again.",
            ),
        };
    }

    public get fabric() {
        return {
            addFabricAccount: l10n.t("+ Add Fabric Account"),
        };
    }

    public get fabricProvisioning() {
        return {
            loadingFabricProvisioning: l10n.t("Loading Fabric provisioning..."),
            sqlDatabaseInFabric: l10n.t("SQL database in Fabric"),
            createDatabase: l10n.t("Create Database"),
            loadingWorkspaces: l10n.t("Loading workspaces"),
            errorLoadingWorkspaces: l10n.t(
                "Error loading workspaces. Please try choosing a different account or tenant.",
            ),
            finishedDeployment: l10n.t("Finished Deployment"),
            deploymentInProgress: l10n.t("Deployment in progress"),
            deploymentName: l10n.t("Deployment Name"),
            workspace: l10n.t("Workspace"),
            startTime: l10n.t("Start Time"),
            provisioning: l10n.t("Provisioning"),
            deploymentFailed: l10n.t("Deployment Failed"),
            connectionFailed: l10n.t("Connection Failed"),
            connectingToDatabase: l10n.t("Connecting to Database"),
            builtOnAzureSQL: l10n.t("OLTP, built on Azure SQL"),
            builtOnAzureSQLDescription: l10n.t(
                "Developer-friendly transactional database using the Azure SQL Database Engine.",
            ),
            analyticsReady: l10n.t("Analytics-ready by default"),
            analyticsReadyDescription: l10n.t(
                "Data automatically replicated to OneLake in real time with a SQL analytics endpoint.",
            ),
            integratedAndSecure: l10n.t("Integrated & secure"),
            integratedAndSecureDescription: l10n.t(
                "Works with VS Code/SSMS and uses Microsoft Entra authentication and Fabric access controls.",
            ),
            smartPerformance: l10n.t("Smart performance"),
            smartPerformanceDescription: l10n.t(
                "Automatic tuning features like automatic index creation enabled by default.",
            ),
        };
    }

    public get azureSqlDatabase() {
        return {
            loadingAzureSqlDatabase: l10n.t("Loading Azure SQL Database..."),
            azureSqlDatabaseHeader: l10n.t("Create an Azure SQL Database (Preview)"),
            azureSqlDatabaseDescription: l10n.t(
                "Try Azure SQL Database at no cost with our free tier offer! Provision a fully managed cloud database directly from VS Code.",
            ),
            oltpAzureSql: l10n.t("OLTP, built on Azure SQL"),
            oltpAzureSqlDescription: l10n.t(
                "Developer-friendly transactional database using the Azure SQL Database Engine — at no cost for prototyping and learning.",
            ),
            freeComputeAndScaling: l10n.t("Free compute & storage"),
            freeComputeAndScalingDescription: l10n.t(
                "Up to 10 databases with 100K vCore seconds, 32 GB storage, and backups renewed monthly.",
            ),
            integratedAndSecure: l10n.t("Integrated & secure"),
            integratedAndSecureDescription: l10n.t(
                "Built-in encryption, firewall rules, and Microsoft Entra ID integration to protect your data.",
            ),
            learnMore: l10n.t("Learn more"),
            learnMoreAboutFreeTier: l10n.t("Learn more about Azure SQL Database free tier"),
            compareTiers: l10n.t("Compare Azure SQL Database service tiers"),
            configureAndCustomize: l10n.t("Configure and customize Azure SQL Databases"),
            createDatabase: l10n.t("Create Database"),
            provisioning: l10n.t("Provisioning"),
            deploymentInProgress: l10n.t("Deployment in progress"),
            finishedDeployment: l10n.t("Deployment finished"),
            deploymentFailed: l10n.t("Deployment failed"),
            deploymentName: l10n.t("Database"),
            startTime: l10n.t("Start Time"),
            subscription: l10n.t("Subscription"),
            resourceGroup: l10n.t("Resource Group"),
            server: l10n.t("Server"),
            region: l10n.t("Region"),
            loadingSubscriptions: l10n.t("Loading subscriptions"),
            loadingResourceGroups: l10n.t("Loading resource groups"),
            loadingAzureAccounts: l10n.t("Loading Azure accounts"),
            loadingTenants: l10n.t("Loading tenants"),
            loadingServers: l10n.t("Loading servers"),
            connectingToDatabase: l10n.t("Connecting to database"),
            connectionFailed: l10n.t("Connection failed"),
            createNewResourceGroup: l10n.t("Create New Resource Group"),
            resourceGroupName: l10n.t("Resource Group Name"),
            location: l10n.t("Location"),
            enterResourceGroupName: l10n.t("Enter resource group name"),
            selectLocation: l10n.t("Select location"),
            loadingLocations: l10n.t("Loading locations"),
            creatingResourceGroup: l10n.t("Creating resource group..."),
            create: l10n.t("Create"),
            createNewServer: l10n.t("Create New Server"),
            serverName: l10n.t("Server Name"),
            enterServerName: l10n.t("Enter server name"),
            creatingServer: l10n.t("Creating server..."),
            createNew: l10n.t("Create new"),
            authenticationType: l10n.t("Authentication Type"),
            sqlLogin: l10n.t("SQL Authentication"),
            azureMFA: l10n.t("Microsoft Entra ID"),
            azureMFAAndUser: l10n.t("Both"),
            userName: l10n.t("User Name"),
            enterUserName: l10n.t("Enter user name"),
            password: l10n.t("Password"),
            enterPassword: l10n.t("Enter password"),
            savePassword: l10n.t("Save password"),
            userNameIsRequired: l10n.t("User name is required"),
            passwordIsRequired: l10n.t("Password is required"),
            freeLimitBehavior: l10n.t("Behavior when free offer limit is reached"),
            autoPauseOption: l10n.t("Auto-pause the database until next month"),
            autoPauseDescription: l10n.t(
                "Database pauses until the next billing cycle when free amount is renewed.",
            ),
            continueChargesOption: l10n.t("Continue using for additional charges"),
            continueChargesDescription: l10n.t(
                "Additional usage beyond the free amount will be charged at serverless rates.",
            ),
            continueChargesWarning: l10n.t(
                "Your database will continue running after the free offer limit and you will be charged for overages.",
            ),
            freeOfferApplied: l10n.t("Free offer applied"),
            monthlyLimits: l10n.t("Monthly limits"),
            freeVCoreLimit: l10n.t("100K vCore seconds"),
            freeStorageLimit: l10n.t("32 GB storage + 32 GB backup"),
            freeDatabaseLimit: l10n.t("Max 10 databases / subscription"),
            freeBackupType: l10n.t("LRS backup (locally redundant)"),
            freeSettingsFixed: l10n.t("Settings are fixed for free tier."),
            computeAndStorage: l10n.t("Compute + Storage"),
            serviceTier: l10n.t("Service tier"),
            compute: l10n.t("Compute"),
            storage: l10n.t("Storage"),
            backup: l10n.t("Backup"),
            autoPause: l10n.t("Auto-pause"),
            advanced: l10n.t("Advanced"),
            backupRedundancy: l10n.t("Backup Storage Redundancy"),
            locallyRedundant: l10n.t("Locally-redundant backup storage"),
            zoneRedundant: l10n.t("Zone-redundant backup storage"),
            geoRedundant: l10n.t("Geo-redundant backup storage"),
            collation: l10n.t("Collation"),
            connectionTimeout: l10n.t("Connection Timeout (seconds)"),
            adminLogin: l10n.t("Admin Username"),
            enterAdminLogin: l10n.t("Enter admin username"),
            adminPassword: l10n.t("Admin Password"),
            enterAdminPassword: l10n.t("Enter admin password"),
            confirmPassword: l10n.t("Confirm Password"),
            enterConfirmPassword: l10n.t("Confirm admin password"),
            passwordsDoNotMatch: l10n.t("Passwords do not match"),
            enableAlwaysEncrypted: l10n.t("Always Encrypted"),
            dataSource: l10n.t("Data Source"),
            selectDataSource: l10n.t("Select a data source"),
            loadingMaintenanceConfigs: l10n.t("Loading maintenance windows..."),
            loadingCollations: l10n.t("Loading collations..."),
            tags: l10n.t("Tags"),
            addTag: l10n.t("Add tag"),
            removeTag: l10n.t("Remove tag"),
            tagKeyPlaceholder: l10n.t("Key"),
            tagValuePlaceholder: l10n.t("Value"),
            duplicateTagKeys: l10n.t("Tag keys must be unique."),
            firewall: l10n.t("Firewall"),
            generalPurpose: l10n.t("General Purpose"),
            serverless: l10n.t("Serverless"),
            vCores: l10n.t("vCores"),
            defaultVCores: l10n.t("1"),
            defaultStorage: l10n.t("32 GB"),
            defaultBackup: l10n.t("LRS"),
            defaultAutoPause: l10n.t("60 min"),
            firewallDescription: (ip: string) =>
                l10n.t({
                    message: "Your current IP {0} will be added automatically.",
                    args: [ip],
                    comment: ["{0} is the current IP address"],
                }),

            whatsNext: l10n.t("What's next?"),
            connectAndRunQuery: l10n.t("Connect with SQL tools and run your first query"),
            seedSampleData: l10n.t("Seed sample data or import an existing schema"),
            monitorUsage: l10n.t("Monitor usage and manage your free tier limits"),
            browseTutorials: l10n.t("Browse Azure SQL Database tutorials and docs"),
        };
    }

    public get changePasswordDialog() {
        return {
            title: l10n.t("Change Password"),
            description: (serverName: string) =>
                l10n.t({
                    message: "Password must be changed to continue logging into '{0}'",
                    args: [serverName],
                    comment: ["{0} is the name of the server"],
                }),
            dialogAriaLabel: (userName: string, serverName: string) =>
                l10n.t({
                    message: "Password must be changed for '{0}' to continue logging into '{1}'",
                    args: [userName, serverName],
                    comment: ["{0} is the username", "{1} is the name of the server"],
                }),
            username: l10n.t("Username"),
            newPassword: l10n.t("New Password"),
            passwordIsRequired: l10n.t("Password is required"),
            newPasswordPlaceholder: l10n.t("Enter new password"),
            showNewPassword: l10n.t("Show New Password"),
            hideNewPassword: l10n.t("Hide New Password"),
            confirmPassword: l10n.t("Confirm Password"),
            confirmPasswordPlaceholder: l10n.t("Confirm new password"),
            showConfirmPassword: l10n.t("Show Confirm Password"),
            hideConfirmPassword: l10n.t("Hide Confirm Password"),
            changePasswordButton: l10n.t("Change Password"),
            cancelButton: l10n.t("Cancel"),
            passwordsDoNotMatch: l10n.t("Passwords do not match"),
        };
    }

    public get createDatabase() {
        return {
            title: l10n.t("Create Database"),
            description: (serverName: string) =>
                l10n.t({
                    message: "Create a new database on '{0}'.",
                    args: [serverName],
                    comment: ["{0} is the name of the server"],
                }),
            loading: l10n.t("Loading..."),
            generalSection: l10n.t("General"),
            optionsSection: l10n.t("Advanced Options"),
            nameLabel: l10n.t("Database Name"),
            namePlaceholder: l10n.t("Enter database name"),
            nameRequired: this.common.databaseNameRequired,
            nameTooLong: this.common.databaseNameTooLong,
            ownerLabel: l10n.t("Owner"),
            collationLabel: l10n.t("Collation"),
            recoveryModelLabel: l10n.t("Recovery Model"),
            compatibilityLevelLabel: l10n.t("Compatibility Level"),
            containmentTypeLabel: l10n.t("Containment Type"),
            isLedgerDatabaseLabel: l10n.t("Is Ledger Database"),
            helpButton: l10n.t("Help"),
            scriptButton: l10n.t("Script"),
            createButton: l10n.t("Create"),
            cancelButton: l10n.t("Cancel"),
            creatingDatabase: l10n.t("Creating database"),
        };
    }

    public get dropDatabase() {
        return {
            title: l10n.t("Drop Database"),
            description: (databaseName: string, serverName: string) =>
                l10n.t({
                    message: "Drop '{0}' from '{1}'. This action cannot be undone.",
                    args: [databaseName, serverName],
                    comment: ["{0} is the database name", "{1} is the server name"],
                }),
            loading: l10n.t("Loading..."),
            detailsSection: l10n.t("Database Details"),
            optionsSection: l10n.t("Drop Database Options"),
            nameLabel: l10n.t("Database"),
            nameColumn: l10n.t("Name"),
            ownerColumn: l10n.t("Owner"),
            statusColumn: l10n.t("Status"),
            valueUnknown: l10n.t("-"),
            dropConnections: l10n.t("Drop active connections"),
            deleteBackupHistory: l10n.t("Delete backup and restore history"),
            confirmationLabel: l10n.t("I understand this action is permanent and irreversible"),
            helpButton: l10n.t("Help"),
            scriptButton: l10n.t("Script"),
            dropButton: l10n.t("Drop"),
            cancelButton: l10n.t("Cancel"),
            droppingDatabase: l10n.t("Dropping database"),
        };
    }

    public get renameDatabase() {
        return {
            title: l10n.t("Rename Database"),
            description: (databaseName: string, serverName: string) =>
                l10n.t({
                    message: "Rename '{0}' on '{1}'.",
                    args: [databaseName, serverName],
                    comment: ["{0} is the current database name", "{1} is the server name"],
                }),
            loading: l10n.t("Loading..."),
            detailsSection: l10n.t("Database Details"),
            optionsSection: l10n.t("Rename Options"),
            nameColumn: l10n.t("Name"),
            ownerColumn: l10n.t("Owner"),
            statusColumn: l10n.t("Status"),
            valueUnknown: l10n.t("-"),
            newNameLabel: l10n.t("New Database Name"),
            newNamePlaceholder: l10n.t("Enter new database name"),
            newNameRequired: this.common.databaseNameRequired,
            newNameTooLong: this.common.databaseNameTooLong,
            newNameUnchanged: l10n.t("New database name must be different from the current name"),
            dropConnections: l10n.t("Drop active connections"),
            helpButton: l10n.t("Help"),
            scriptButton: l10n.t("Script"),
            renameButton: l10n.t("Rename"),
            cancelButton: l10n.t("Cancel"),
            renamingDatabase: l10n.t("Renaming database"),
        };
    }

    public get dacpacDialog() {
        return {
            title: l10n.t("Data-tier Application"),
            subtitle: l10n.t(
                "Deploy, extract, import, or export data-tier applications on the selected database",
            ),
            loading: l10n.t("Loading..."),
            operationLabel: l10n.t("Operation"),
            selectOperation: l10n.t("Select an operation"),
            serverLabel: l10n.t("Server"),
            selectServer: l10n.t("Select a server"),
            noConnectionsAvailable: l10n.t(
                "No connections available. Please create a connection first.",
            ),
            connectingToServer: l10n.t("Connecting to server..."),
            connectionFailed: l10n.t("Failed to connect to server"),
            deployDacpac: l10n.t("Publish DACPAC"),
            extractDacpac: l10n.t("Extract DACPAC"),
            importBacpac: l10n.t("Import BACPAC"),
            exportBacpac: l10n.t("Export BACPAC"),
            deployDescription: l10n.t("Deploy a .dacpac file to a new or existing SQL database"),
            extractDescription: l10n.t("Extract the schema from a SQL database to a .dacpac file"),
            importDescription: l10n.t("Import a .bacpac file to a new or empty database"),
            exportDescription: l10n.t(
                "Export the schema and data from a SQL database to a .bacpac file",
            ),
            packageFileLabel: l10n.t("Package file"),
            outputFileLabel: l10n.t("Output file"),
            selectPackageFile: l10n.t("Select package file"),
            selectOutputFile: l10n.t("Enter the path for the output file"),
            browse: l10n.t("Browse..."),
            targetDatabaseLabel: l10n.t("Target Database"),
            sourceDatabaseLabel: l10n.t("Source Database"),
            databaseNameLabel: l10n.t("Database Name"),
            newDatabase: l10n.t("New Database"),
            existingDatabase: l10n.t("Existing Database"),
            selectDatabase: l10n.t("Select a database"),
            enterDatabaseName: l10n.t("Enter database name"),
            applicationNameLabel: l10n.t("Application Name"),
            enterApplicationName: l10n.t("Enter application name"),
            applicationVersionLabel: l10n.t("Application Version"),
            cancel: l10n.t("Cancel"),
            execute: l10n.t("Execute"),
            filePathRequired: l10n.t("File path is required"),
            invalidFile: l10n.t("Invalid file"),
            databaseNameRequired: this.common.databaseNameRequired,
            invalidDatabase: l10n.t("Invalid database"),
            validationFailed: l10n.t("Validation failed"),
            deployingDacpac: l10n.t("Deploying DACPAC..."),
            extractingDacpac: l10n.t("Extracting DACPAC..."),
            importingBacpac: l10n.t("Importing BACPAC..."),
            exportingBacpac: l10n.t("Exporting BACPAC..."),
            operationFailed: l10n.t("Operation failed"),
            unexpectedError: l10n.t("An unexpected error occurred"),
            failedToLoadDatabases: l10n.t("Failed to load databases"),
            databasesCannotBeLoadedDueToPermissions: l10n.t(
                "Unable to retrieve the list of databases. You may not have permission to list databases on this server. If your connection specifies a database, it will be preselected.",
            ),
            deploySuccess: l10n.t("DACPAC deployed successfully"),
            extractSuccess: l10n.t("DACPAC extracted successfully"),
            importSuccess: l10n.t("BACPAC imported successfully"),
            exportSuccess: l10n.t("BACPAC exported successfully"),
            deployToExistingWarning: l10n.t("Deploy to Existing Database"),
            deployToExistingMessage: l10n.t(
                "You are about to deploy to an existing database. This operation will make permanent changes to the database schema and may result in data loss. Do you want to continue?",
            ),
            deployToExistingConfirm: l10n.t("Deploy"),
            databaseAlreadyExists: l10n.t("A database with this name already exists on the server"),
            invalidApplicationVersion: l10n.t(
                "Application version must be in format n.n.n or n.n.n.n where n is a number (e.g., 1.0.0.0)",
            ),
            learnMore: l10n.t("Learn More"),
        };
    }

    public get tableExplorer() {
        return {
            saveChanges: l10n.t("Save Changes"),
            addRow: l10n.t("Add Row"),
            openInEditor: l10n.t("Open in Editor"),
            openInSqlEditor: l10n.t("Open in SQL Editor"),
            copyScript: l10n.t("Copy Script"),
            copyScriptToClipboard: l10n.t("Copy Script to Clipboard"),
            maximizePanelSize: l10n.t("Maximize Panel Size"),
            restorePanelSize: l10n.t("Restore Panel Size"),
            updateScript: l10n.t("Update Script"),
            deleteRow: l10n.t("Delete Row"),
            revertCell: l10n.t("Revert Cell"),
            revertRow: l10n.t("Revert Row"),
            totalRowsToFetch: l10n.t("Total rows to fetch:"),
            rowsPerPage: l10n.t("Rows per page"),
            firstPage: l10n.t("First Page"),
            previousPage: l10n.t("Previous Page"),
            nextPage: l10n.t("Next Page"),
            lastPage: l10n.t("Last Page"),
            loadingTableData: l10n.t("Loading table data..."),
            noDataAvailable: l10n.t("No data available"),
            noPendingChanges: l10n.t("No pending changes. Make edits to generate a script."),
            closeScriptPane: l10n.t("Close Script Pane"),
            modifyTable: l10n.t("Modify Table"),
            viewTableDiagram: l10n.t("View Table Diagram"),
            showSqlPane: l10n.t("Show SQL Pane"),
            hideSqlPane: l10n.t("Hide SQL Pane"),
            scriptChanges: l10n.t("Changes"),
            tableQuery: l10n.t("SQL"),
            export: l10n.t("Export"),
            columns: l10n.t("Columns"),
            deleteSelected: (count: number) =>
                count === 1 ? l10n.t("Delete 1 row") : l10n.t("Delete {0} rows", count),
            showSql: l10n.t("Show SQL"),
            openSqlInEditor: l10n.t("Open the generated SELECT statement in a new editor"),
            filters: l10n.t("Filters"),
            filtersTooltip: l10n.t("Add filters to modify the SQL query"),
            filterWhere: l10n.t("WHERE"),
            filterAnd: l10n.t("and"),
            filterOr: l10n.t("or"),
            filterConjunction: l10n.t("Conjunction"),
            filterColumn: l10n.t("Column"),
            filterOperator: l10n.t("Operator"),
            filterLogicalOperator: l10n.t("Logical operator"),
            filterValue: l10n.t("Filter value"),
            filterApply: l10n.t("Apply"),
            filterAdd: l10n.t("Add filter"),
            filterClear: l10n.t("Clear filters"),
            filterRemove: l10n.t("Remove filter"),
            filterValuePlaceholder: l10n.t("value"),
            filterOpEquals: l10n.t("equals"),
            filterOpNotEquals: l10n.t("not equals"),
            filterOpContains: l10n.t("contains"),
            filterOpNotContains: l10n.t("does not contain"),
            filterOpStartsWith: l10n.t("starts with"),
            filterOpEndsWith: l10n.t("ends with"),
            filterOpGreaterThan: l10n.t("greater than"),
            filterOpLessThan: l10n.t("less than"),
            filterOpIsNull: l10n.t("is null"),
            filterOpIsNotNull: l10n.t("is not null"),
            vectorReadonlyTooltip: l10n.t(
                "Vector values are read-only in this editor. Use T-SQL to modify the value or regenerate the embedding.",
            ),
        };
    }

    public get searchDatabase() {
        return {
            // Page titles and headers
            title: l10n.t("Search Database Objects"),
            loading: l10n.t("Loading database objects"),
            connectingTo: (serverName: string) =>
                l10n.t({
                    message: "Connecting to {0}...",
                    args: [serverName],
                    comment: ["{0} is the server name"],
                }),
            defaultError: l10n.t("An error occurred while loading data."),
            errorLoadingDatabaseObjects: l10n.t("Error loading database objects"),
            searching: l10n.t("Searching..."),
            objectsFound: (count: number) =>
                l10n.t({
                    message: "{0} objects found",
                    args: [count],
                    comment: ["{0} is the number of objects found"],
                }),

            // Filter labels
            database: l10n.t("Database"),
            objectTypes: l10n.t("Object Types"),
            tables: l10n.t("Tables"),
            views: l10n.t("Views"),
            storedProcedures: l10n.t("Stored Procedures"),
            functions: l10n.t("Functions"),
            schemas: l10n.t("Schemas"),
            all: l10n.t("All"),
            none: l10n.t("None"),

            // Type names (singular, for display)
            typeTable: l10n.t("Table"),
            typeView: l10n.t("View"),
            typeStoredProcedure: l10n.t("Stored Procedure"),
            typeFunction: l10n.t("Function"),

            // Toolbar
            searchPlaceholder: l10n.t(
                "Search by object name or type (e.g. t:<name>, v:, f:, or sp:)",
            ),

            // Results table headers
            name: l10n.t("Name"),
            schema: l10n.t("Schema"),
            type: l10n.t("Type"),
            actions: l10n.t("Actions"),

            // Empty state
            noObjectsFound: l10n.t("No objects found"),
            tryAdjustingFilters: l10n.t("Try adjusting your search or filters"),

            // Column header filters
            filterByName: l10n.t("Filter by name"),
            filterBySchema: l10n.t("Filter by schema"),
            filterByType: l10n.t("Filter by type"),
            filterColumnAriaLabel: (columnName: string) => l10n.t("Filter {0}", columnName),
            selectAll: l10n.t("Select All"),

            // Action menu items
            selectTop1000: l10n.t("Select Top 1000"),
            scriptAsCreate: l10n.t("Script as Create"),
            scriptAsDrop: l10n.t("Script as Drop"),
            scriptAsAlter: l10n.t("Script as Alter"),
            scriptAsExecute: l10n.t("Script as Execute"),
            editData: l10n.t("Edit Data"),
            modifyTable: l10n.t("Modify Table"),
            copyObjectName: l10n.t("Copy Object Name"),
        };
    }

    // SlickGrid-specific localization strings
    public get slickGrid() {
        return {
            filterContains: l10n.t("Contains"),
            filterNotContains: l10n.t("Not contains"),
            filterEquals: l10n.t("Equals"),
            filterNotEqualTo: l10n.t("Not equal to"),
            filterStartsWith: l10n.t("Starts with"),
            filterEndsWith: l10n.t("Ends with"),
            allSelected: l10n.t("All selected"),
            cancel: l10n.t("Cancel"),
            clearAllFilters: l10n.t("Clear all filters"),
            clearAllGrouping: l10n.t("Clear all grouping"),
            clearAllSorting: l10n.t("Clear all sorting"),
            clearPinning: l10n.t("Unfreeze columns/rows"),
            collapseAllGroups: l10n.t("Collapse all groups"),
            columns: l10n.t("Columns"),
            columnResizeByContent: l10n.t("Column resize by content"),
            commands: l10n.t("Commands"),
            copy: l10n.t("Copy"),
            copyWithHeaders: l10n.t("Copy with Headers"),
            copyHeaders: l10n.t("Copy Headers"),
            expandAllGroups: l10n.t("Expand all groups"),
            exportToCsv: l10n.t("Export to CSV"),
            exportToExcel: l10n.t("Export to Excel"),
            exportToPdf: l10n.t("Export to PDF"),
            exportToJson: l10n.t("Export to JSON"),
            exportToTextFormat: l10n.t("Export to text format"),
            exportToTabDelimited: l10n.t("Export to tab delimited"),
            filterShortcuts: l10n.t("Filter shortcuts"),
            forceFitColumns: l10n.t("Force fit columns"),
            freezeColumns: l10n.t("Freeze columns"),
            greaterThan: l10n.t("Greater than"),
            greaterThanOrEqualTo: l10n.t("Greater than or equal to"),
            groupBy: l10n.t("Group by"),
            hideColumn: l10n.t("Hide column"),
            items: l10n.t("items"),
            itemsPerPage: l10n.t("items per page"),
            itemsSelected: l10n.t("items selected"),
            lessThan: l10n.t("Less than"),
            lessThanOrEqualTo: l10n.t("Less than or equal to"),
            loading: l10n.t("Loading..."),
            noElementsFound: l10n.t("No elements found"),
            noMatchesFound: l10n.t("No matches found"),
            of: l10n.t("of"),
            ok: l10n.t("OK"),
            options: l10n.t("Options"),
            page: l10n.t("Page"),
            refreshDataset: l10n.t("Refresh dataset"),
            removeFilter: l10n.t("Remove filter"),
            removeSort: l10n.t("Remove sort"),
            save: l10n.t("Save"),
            selectAll: l10n.t("Select all"),
            showAllColumns: l10n.t("Show all columns"),
            sortAscending: l10n.t("Sort ascending"),
            sortDescending: l10n.t("Sort descending"),
            synchronousResize: l10n.t("Synchronous resize"),
            toggleDarkMode: l10n.t("Toggle dark mode"),
            toggleFilterRow: l10n.t("Toggle filter row"),
            togglePreHeaderRow: l10n.t("Toggle pre-header row"),
            unfreezeColumns: l10n.t("Unfreeze columns"),
            xOfYSelected: l10n.t("x of y selected"),
            equalTo: l10n.t("Equal to"),
        };
    }

    public get azureDataStudioMigration() {
        return {
            title: l10n.t("Azure Data Studio Migration"),
            subtitle: l10n.t(
                "Bring your saved connections, groups, and configuration from Azure Data Studio into the MSSQL extension and discover familiar experiences.",
            ),
            configInputLabel: l10n.t("Azure Data Studio settings file"),
            configInputDescription: l10n.t(
                "Select the Azure Data Studio settings.json file to scan for connection groups and connections.",
            ),
            configInputPlaceholder: l10n.t("Browse to Azure Data Studio settings.json"),
            browseButton: l10n.t("Browse"),
            connectionGroupsHeader: l10n.t("Connection groups to import"),
            connectionGroupsSelection: (selected: number, total: number) =>
                l10n.t({
                    message: "{0} of {1} connection groups selected.",
                    args: [selected, total],
                    comment: [
                        "{0} is the number of groups selected for import",
                        "{1} is the total number of groups detected",
                    ],
                }),
            groupsRootNote: l10n.t(
                "Connections in groups that are not selected will be moved under the root.",
            ),
            noConnectionGroups: l10n.t("No connection groups were found in the file."),
            groupNameColumn: l10n.t("Name"),
            groupColorColumn: l10n.t("Color"),
            groupColorSwatch: (groupName: string, color: string) =>
                l10n.t({
                    message: "{0} color swatch ({1})",
                    args: [groupName, color],
                    comment: [
                        "{0} is the connection group name",
                        "{1} is the color value applied to the group",
                    ],
                }),
            selectAllGroupsLabel: l10n.t("Select or clear all connection groups"),
            groupSelectionToggle: (groupName: string) =>
                l10n.t({
                    message: "Toggle selection for {0}",
                    args: [groupName],
                    comment: ["{0} is the connection group name"],
                }),
            connectionsHeader: l10n.t("Connections to import"),
            connectionsSelection: (selected: number, total: number) =>
                l10n.t({
                    message: "{0} of {1} connections selected",
                    args: [selected, total],
                    comment: [
                        "{0} is the number of connections selected for import",
                        "{1} is the total number of connections detected",
                    ],
                }),
            selectAllConnectionsLabel: l10n.t("Select or clear all connections"),
            noConnections: l10n.t("No connections were found in the file."),
            connectionProfileName: l10n.t("Profile name"),
            connectionServerColumn: l10n.t("Server"),
            connectionDatabaseColumn: l10n.t("Database"),
            connectionDatabaseDefault: l10n.t("<default>"),
            connectionAuthColumn: l10n.t("Auth type"),
            connectionUserColumn: l10n.t("User ID"),
            connectionStatusColumn: l10n.t("Status"),
            connectionSelectionToggle: (connectionName: string) =>
                l10n.t({
                    message: "Toggle selection for {0}",
                    args: [connectionName],
                    comment: ["{0} is the connection display name"],
                }),
            connectionGroupsCollapse: l10n.t("Collapse connection groups"),
            connectionGroupsExpand: l10n.t("Expand connection groups"),
            connectionsCollapse: l10n.t("Collapse connections"),
            connectionsExpand: l10n.t("Expand connections"),
            connectionDisplayNameMissing: l10n.t(
                "This connection does not have a display name in Azure Data Studio.",
            ),
            connectionValueMissing: l10n.t(
                "This value was not provided in the Azure Data Studio settings file.",
            ),
            authenticationColumn: l10n.t("Authentication"),
            enterPassword: l10n.t("Enter password"),
            importButtonLabel: l10n.t("Import selected"),
            importWarningDialogTitle: l10n.t("Connection Import Warning"),
            importWarningDialogMessage: l10n.t(
                "Some connections or groups have incomplete information. You can continue, but you may need to edit these connections later before connecting.",
            ),
            importWarningConnectionsHeader: l10n.t("Incomplete or orphaned connections"),
            importWarningProceed: l10n.t("Import anyway"),
            importProgressDialogTitle: l10n.t("Importing selections"),
            entraSignInAccountLabel: l10n.t("Account"),
            entraSignInTenantLabel: l10n.t("Tenant"),
            entraSignInLink: l10n.t("Sign into additional accounts"),
            selectAccount: l10n.t("Select account"),
            entraSignInDialogTitle: l10n.t("Select an account for authentication"),
            entraSignInDialogMessage: l10n.t(
                "Select a Microsoft Entra ID account to use with this connection.  The original account information from Azure Data Studio is listed below, but you can choose a different account.",
            ),
            settingsHeader: l10n.t("Settings and Keybindings"),
            settingsCollapse: l10n.t("Collapse settings"),
            settingsExpand: l10n.t("Expand settings"),
            importSettingsCheckboxLabel: l10n.t(
                "Import connection configuration settings from Azure Data Studio",
            ),
            viewSettingsButton: l10n.t("View settings"),
            viewSettingsDialogTitle: l10n.t("Configuration to Import"),
            settingsKeyColumn: l10n.t("Setting"),
            settingsValueColumn: l10n.t("Value"),
            noCustomizedSettingsFound: l10n.t("No customized settings found"),
            noCustomizedSettingsFoundInAds: l10n.t(
                "No customized settings found in Azure Data Studio",
            ),
            keymapCallout: l10n.t(
                "Looking for Azure Data Studio key bindings, like F5 to execute queries?",
            ),
            keymapTooltip: l10n.t(
                "Download the keymap extension to automatically import key mappings from Azure Data Studio. These changes will show in your keyboard shortcut preferences.",
            ),
            keymapCalloutLink: l10n.t("Install the MSSQL Database Management Keymap extension"),
            importedConnectionGroups: (count: number) =>
                count === 1
                    ? l10n.t({
                          message: "{0} connection group imported",
                          args: [count],
                          comment: ["{0} is the number of connection groups imported (singular)"],
                      })
                    : l10n.t({
                          message: "{0} connection groups imported",
                          args: [count],
                          comment: ["{0} is the number of connection groups imported (plural)"],
                      }),
            importedConnections: (count: number) =>
                count === 1
                    ? l10n.t({
                          message: "{0} connection imported",
                          args: [count],
                          comment: ["{0} is the number of connections imported (singular)"],
                      })
                    : l10n.t({
                          message: "{0} connections imported",
                          args: [count],
                          comment: ["{0} is the number of connections imported (plural)"],
                      }),
            importedSettings: (count: number) =>
                count === 1
                    ? l10n.t({
                          message: "{0} setting imported",
                          args: [count],
                          comment: ["{0} is the number of settings imported (singular)"],
                      })
                    : l10n.t({
                          message: "{0} settings imported",
                          args: [count],
                          comment: ["{0} is the number of settings imported (plural)"],
                      }),
        };
    }

    public get changelog() {
        return {
            pageTitle: l10n.t("MSSQL: What's new"),
            headerIconAlt: l10n.t("MSSQL extension icon"),
            highlightsSectionTitle: l10n.t("Highlights"),
            resourcesSectionTitle: l10n.t("Resources"),
            gettingStartedSectionTitle: l10n.t("Getting Started"),
            gettingStartedDescription: l10n.t(
                "New to MSSQL extension? Check out our quick-start guide.",
            ),
            previewBadge: l10n.t("Preview"),
            footerText: (version: string) =>
                l10n.t({
                    message:
                        "You are seeing this message because you updated the MSSQL extension to version {0}.",
                    args: [version],
                    comment: ["{0} is the version number of the MSSQL extension"],
                }),
            dontShowAgain: l10n.t("Don't show this again"),
            close: l10n.t("Close"),
        };
    }

    public get fileBrowser() {
        return {
            fileBrowserFileTitle: l10n.t("Select a file"),
            fileBrowserFolderTitle: l10n.t("Select a folder"),
            folderRequired: l10n.t("Folder is required"),
            fileRequired: l10n.t("File is required"),
            pleaseSelectAFile: l10n.t("Please select a file, not a folder."),
            selectedPath: l10n.t("Selected Path"),
            filesOfType: l10n.t("Files of Type"),
            filePath: l10n.t("File path"),
            folderPath: l10n.t("Folder path"),
        };
    }

    public get backupDatabase() {
        return {
            backupDatabaseTitle: (databaseName: string) =>
                l10n.t({
                    message: "Backup Database - {0}",
                    args: [databaseName],
                    comment: ["{0} is the database name"],
                }),
            loadingBackupDatabase: l10n.t("Loading backup database..."),
            backup: l10n.t("Backup"),
            script: l10n.t("Script"),
            advanced: l10n.t("Advanced"),
            advancedBackupOptions: l10n.t("Advanced Backup Options"),
            searchOptions: l10n.t("Search options"),
            saveToUrl: l10n.t("Save to URL"),
            saveToDisk: l10n.t("Save to Disk"),
            backupLocation: l10n.t("Backup Location"),
            backupFiles: l10n.t("Backup Files"),
            createNew: l10n.t("Create New"),
            chooseExisting: l10n.t("Choose Existing"),
            folderPath: l10n.t("Folder Path"),
            fileName: l10n.t("File Name"),
            existingFile: l10n.t("Existing File"),
            newFile: l10n.t("New File"),
            browseForPath: l10n.t("Browse forvpath"),
            removeFile: l10n.t("Remove file"),
            chooseAtLeastOneFile: l10n.t("Please choose at least one backup file"),
            chooseUniqueFile: l10n.t("Please choose a unique backup file name"),
            loading: l10n.t("Loading..."),
            folderPathRequired: l10n.t("Folder path is required"),
            fileNameRequired: l10n.t("File name is required"),
            transactionLog: l10n.t("Transaction Log"),
            encryption: l10n.t("Encryption"),
            media: l10n.t("Media"),
        };
    }

    public get profiler() {
        return {
            // Toolbar buttons
            newSession: l10n.t("New Session"),
            creatingSession: l10n.t("Creating..."),
            start: l10n.t("Start"),
            stop: l10n.t("Stop"),
            pause: l10n.t("Pause"),
            resume: l10n.t("Resume"),
            clear: l10n.t("Clear Data"),
            autoScroll: l10n.t("Auto-scroll"),
            filter: l10n.t("Filter..."),
            clearFilter: l10n.t("Clear Filter"),

            // Toolbar labels
            sessionLabel: l10n.t("Session"),
            selectSessionAriaLabel: l10n.t("Select session"),
            selectSessionLabel: l10n.t("Select session"),
            viewLabel: l10n.t("View:"),
            selectASession: l10n.t("Select a session..."),
            readOnlyFileLabel: l10n.t("File (Read-Only)"),

            // Tooltips
            creatingSessionTooltip: l10n.t("Creating session..."),
            createNewSessionTooltip: l10n.t("Create a new profiling session"),
            noTemplatesAvailableTooltip: l10n.t("No templates available"),
            selectSessionFirstTooltip: l10n.t("Select a session first"),
            startSessionTooltip: l10n.t("Start profiling session"),
            stopSessionTooltip: l10n.t("Stop session"),
            sessionNotRunningTooltip: l10n.t("Session not running"),
            pauseEventCollectionTooltip: l10n.t("Pause event collection"),
            pausedClickToResumeTooltip: l10n.t("Paused - click to resume"),
            notRunningTooltip: l10n.t("Not running"),
            clearEventsTooltip: l10n.t("Clear all events (keeps session running)"),
            autoScrollEnabledTooltip: l10n.t("Auto-scroll enabled"),
            autoScrollDisabledTooltip: l10n.t("Auto-scroll disabled"),
            filterTooltip: l10n.t("Filter events by column values"),
            sortTooltip: l10n.t("Sort column"),
            clearFilterTooltip: l10n.t("Clear all filters and show all events"),
            clearFilterDisabledTooltip: l10n.t("No filter is currently active"),

            // Filter operators
            operatorEquals: l10n.t("="),
            operatorNotEquals: l10n.t("<>"),
            operatorLessThan: l10n.t("<"),
            operatorLessThanOrEqual: l10n.t("<="),
            operatorGreaterThan: l10n.t(">"),
            operatorGreaterThanOrEqual: l10n.t(">="),
            operatorIsNull: l10n.t("Is Null"),
            operatorIsNotNull: l10n.t("Is Not Null"),
            operatorContains: l10n.t("Contains"),
            operatorNotContains: l10n.t("Not Contains"),
            operatorStartsWith: l10n.t("Starts With"),
            operatorNotStartsWith: l10n.t("Not Starts With"),
            operatorIn: l10n.t("In"),

            // Filter status
            filterActive: l10n.t("Filter active"),
            filterActiveTooltip: (filteredCount: number, totalCount: number) =>
                l10n.t({
                    message: "Showing {0} of {1} events",
                    args: [filteredCount, totalCount],
                    comment: ["{0} is filtered count, {1} is total count"],
                }),
            readOnlyDisabledTooltip: l10n.t("Not available for read-only file sessions"),
            sessionActiveCannotChangeTooltip: l10n.t("Cannot change session while active"),
            xelFileReadOnlyDisconnectedTooltip: (fileName: string) =>
                l10n.t({
                    message:
                        "Read-only disconnected mode for '{0}'. Cannot create or start live sessions without a database connection.",
                    args: [fileName],
                    comment: ["{0} is the XEL file name"],
                }),

            // Session states
            stateRunning: l10n.t("Running"),
            statePaused: l10n.t("Paused"),
            stateStopped: l10n.t("Stopped"),
            stateNotStarted: l10n.t("Not Started"),
            stateReadOnly: l10n.t("Read-Only"),

            // Status bar
            noSession: l10n.t("Query Profiler: No session"),
            sessionStatusTooltip: l10n.t("Query Profiler Session Status"),
            eventsCount: (count: number) =>
                l10n.t({
                    message: "{0} events",
                    args: [count],
                    comment: ["{0} is the number of events"],
                }),

            // Filter popover
            filterColumnHeader: (columnName: string) =>
                l10n.t({
                    message: "Filter: {0}",
                    args: [columnName],
                    comment: ["{0} is the column name"],
                }),
            operatorEndsWith: l10n.t("Ends With"),
            operatorNotEndsWith: l10n.t("Not Ends With"),
            applyFilter: l10n.t("Apply"),
            clearColumnFilter: l10n.t("Clear"),
            searchValues: l10n.t("Search values..."),
            enterText: l10n.t("Enter text..."),
            enterNumber: l10n.t("Enter a number..."),
            enterDate: l10n.t("Enter a date..."),
            selectAll: l10n.t("Select All"),
            deselectAll: l10n.t("Deselect All"),
            numericFilterHint: (columnName: string) =>
                l10n.t({
                    message: "Example: Find queries with {0} > 100",
                    args: [columnName],
                    comment: ["{0} is the column name"],
                }),
            textFilterHint: (columnName: string) =>
                l10n.t({
                    message: "Search within {0} text content",
                    args: [columnName],
                    comment: ["{0} is the column name"],
                }),
            noResultsMatchFilter: l10n.t("No results match the current filters"),
            noDataToDisplay: l10n.t("No data to display."),

            // Quick filter
            quickFilterPlaceholder: l10n.t("Quick filter all columns..."),
            clearAllFilters: l10n.t("Clear All Filters"),
            clearAllFiltersTooltip: l10n.t("Clear quick filter and all column filters"),

            // Popover
            closePopover: l10n.t("Close"),
            emptyCategory: l10n.t("(empty)"),
            selectedCount: (selected: number, total: number) =>
                l10n.t({
                    message: "{0}/{1}",
                    args: [selected, total],
                    comment: ["{0} is selected count", "{1} is total count"],
                }),
            enterDateFormat: l10n.t("YYYY-MM-DD HH:mm:ss"),
            dateFormatError: l10n.t("Use format: YYYY-MM-DD HH:mm:ss[.SSS]"),
            filterValue: l10n.t("Filter value"),
            filterOperator: l10n.t("Filter operator"),

            // Validation
            validationValueRequired: l10n.t("Value is required"),
            validationMustBeNumber: l10n.t("Must be a valid number"),

            // Active filters bar
            filterNoneSelected: l10n.t("none selected"),
            filterCountSelected: (count: number) =>
                l10n.t({
                    message: "{0} selected",
                    args: [count],
                    comment: ["{0} is the number of selected filter values"],
                }),
            activeFiltersLabel: l10n.t("Active filters:"),
            filterBadge: (columnName: string, desc: string) =>
                l10n.t({
                    message: "{0}: {1}",
                    args: [columnName, desc],
                    comment: ["{0} is the column name", "{1} is the filter description"],
                }),
            removeFilter: (columnName: string) =>
                l10n.t({
                    message: "Remove filter for {0}",
                    args: [columnName],
                    comment: ["{0} is the column name"],
                }),
            // Details panel
            detailsPanel: {
                textTab: l10n.t("Text"),
                detailsTab: l10n.t("Details"),
                openInEditor: l10n.t("Open in Editor"),
                maximize: l10n.t("Maximize"),
                restore: l10n.t("Restore"),
                noEventSelected: l10n.t("No event selected"),
                noTextData: l10n.t("No text data available"),
                openInEditorTooltip: l10n.t("Open text data in a new editor"),
                copyTooltip: l10n.t("Copy text data to clipboard"),
                maximizeTooltip: l10n.t("Maximize details panel"),
                restoreTooltip: l10n.t("Restore panel size"),
                closeTooltip: l10n.t("Close details panel"),
                textTabAriaLabel: l10n.t("Text tab - displays SQL text data"),
                detailsTabAriaLabel: l10n.t("Details tab - displays all event properties"),
                editorAriaLabel: l10n.t("Read-only SQL text editor"),
                propertiesListAriaLabel: l10n.t("Event properties list"),
                copiedToClipboard: l10n.t("Copied to clipboard"),
                detailsPanelTabsAriaLabel: l10n.t("Details panel tabs"),
                detailsPanelActionsAriaLabel: l10n.t("Details panel actions"),
                eventDetailsAriaLabel: (eventName: string) =>
                    l10n.t({
                        message: "Event details for {0}",
                        args: [eventName],
                        comment: ["{0} is the name of the profiler event"],
                    }),
            },
            // Export
            exportToCsv: l10n.t("Export to CSV"),
            exportTooltip: l10n.t("Export all captured events to a CSV file"),
            noEventsToExport: l10n.t("No events to export"),
            defaultExportFileName: l10n.t("profiler_events"),
        };
    }

    public get flatFileImport() {
        return {
            importFile: l10n.t("Import File"),
            stepOne: l10n.t("Specify Input File"),
            loadingFlatFileImport: l10n.t("Loading flat file import..."),
            loadingTablePreview: l10n.t("Loading table preview..."),
            browse: l10n.t("Browse"),
            stepTwo: l10n.t("Preview Data"),
            operationPreviewText: l10n.t(
                "This operation analyzed the input file structure to generate the preview below for up to the first 50 rows.",
            ),
            stepThree: l10n.t("Modify Columns"),
            columnName: l10n.t("Column Name"),
            dataType: l10n.t("Data Type"),
            allowNulls: l10n.t("Allow Nulls"),
            primaryKey: l10n.t("Primary Key"),
            importData: l10n.t("Import Data"),
            stepFour: l10n.t("Summary"),
            importInformation: l10n.t("Import Information"),
            importStatus: l10n.t("Import Status"),
            objectType: l10n.t("Object Type"),
            name: l10n.t("Name"),
            serverName: l10n.t("Server Name"),
            databaseName: l10n.t("Database Name"),
            tableName: l10n.t("Table Name"),
            tableSchema: l10n.t("Table Schema"),
            fileToBeImported: l10n.t("File to be imported"),
            importingData: l10n.t("Importing data..."),
            importSuccessful: l10n.t("File imported successfully"),
            showFullErrorMessage: l10n.t("Show full error message"),
            hideFullErrorMessage: l10n.t("Hide full error message"),
            importNewFile: l10n.t("Import New File"),
        };
    }

    public get restoreDatabase() {
        return {
            loadingRestoreDatabase: l10n.t("Loading restore database..."),
            restore: l10n.t("Restore"),
            restoreDatabase: l10n.t("Restore Database"),
            database: l10n.t("Database"),
            backupFile: l10n.t("Backup File"),
            url: l10n.t("URL"),
            browseFiles: l10n.t("Browse files"),
            tailLogBackup: l10n.t("Tail-log backup"),
            files: l10n.t("Files"),
            loadingRestorePlan: l10n.t("Loading restore plan..."),
            noBackupSets: l10n.t("No backup sets found in the restore plan"),
            noDatabaseFiles: l10n.t("No database files found in the restore plan"),
            invalidTableType: l10n.t("Invalid table type"),
            logicalFileName: l10n.t("Logical file name"),
            originalFileName: l10n.t("Original file name"),
            restoreAs: l10n.t("Restore as"),
            fileType: l10n.t("File type"),
            backupSetsToRestore: l10n.t("Backup sets to restore"),
            advancedRestoreOptions: l10n.t("Advanced restore options"),
            couldNotLoadRestorePlan: l10n.t("Could not load restore plan"),
            chooseBackupFile: l10n.t("Please choose a backup file to load restore plan"),
            chooseBlob: l10n.t("Please choose a blob to load restore plan"),
        };
    }
    public get runbookStudio() {
        return {
            author: l10n.t("Author"),
            parameters: l10n.t("Parameters"),
            run: l10n.t("Run"),
            plan: l10n.t("Plan"),
            preview: l10n.t("Preview"),
            results: l10n.t("Results"),
            history: l10n.t("History"),
            debugReplay: l10n.t("Debug & Replay"),
            sectionsAriaLabel: l10n.t("Runbook Studio sections"),
            previewResultsLayout: l10n.t("Preview results layout"),
            previewResultsLayoutDetail: l10n.t(
                "Synthetic bounded data shows how this saved presentation reflows before a real run.",
            ),
            previewWidth: l10n.t("Preview width"),
            previewCompact: l10n.t("Compact"),
            previewMedium: l10n.t("Medium"),
            previewWide: l10n.t("Wide"),
            layoutStrategy: l10n.t("Layout strategy"),
            layoutFlow: l10n.t("Flow"),
            layoutStacked: l10n.t("Stacked"),
            layoutGrid: l10n.t("Grid"),
            previewScenario: l10n.t("Scenario"),
            previewScenarioClean: l10n.t("Clean run"),
            previewScenarioBlockingErrors: l10n.t("Blocking error"),
            previewScenarioApprovalRejected: l10n.t("Approval rejected"),
            branchWidgetsHidden: (count: number) =>
                l10n.t({
                    message: "{0} output widgets hidden — branch not taken",
                    args: [count],
                    comment: [
                        "{0} is the number of output widgets hidden by this preview scenario",
                    ],
                }),
            branchNotTaken: l10n.t("Branch not taken"),
            sample: l10n.t("Sample"),
            noPreviewTitle: l10n.t("Compile a plan to preview its results layout"),
            noPreviewDetail: l10n.t(
                "The preview uses the compiled activity output contracts and never runs SQL or other effects.",
            ),
            customizeLayout: l10n.t("Customize layout"),
            finishCustomizing: l10n.t("Done customizing"),
            outputsDrawer: l10n.t("Outputs"),
            outputsDrawerDetail: l10n.t("Place or hide every typed output from the compiled plan."),
            layoutSection: l10n.t("Section"),
            layoutSectionFor: (label: string) =>
                l10n.t({
                    message: "Section for {0}",
                    args: [label],
                    comment: ["{0} is a runbook plan step label"],
                }),
            layoutWidth: l10n.t("Width"),
            layoutFull: l10n.t("Full"),
            layoutTwoThirds: l10n.t("Two thirds"),
            layoutHalf: l10n.t("Half"),
            layoutThird: l10n.t("One third"),
            moveOutputUp: l10n.t("Move output up"),
            moveOutputDown: l10n.t("Move output down"),
            dragOutputToReorder: (output: string) =>
                l10n.t({
                    message: "Drag {0} to reorder or move between sections",
                    args: [output],
                    comment: ["{0} is an output widget title"],
                }),
            hideOutput: l10n.t("Hide"),
            showOutput: l10n.t("Show"),
            savingLayout: l10n.t("Saving…"),
            layoutChangesPending: l10n.t("Layout changes are ready to apply"),
            layoutRunOnlyApplied: l10n.t("This layout applies only to the current run"),
            applyToRunOnly: l10n.t("Apply to this run only"),
            applyToPreviewOnly: l10n.t("Apply to this preview only"),
            saveLayoutToRunbook: l10n.t("Save to runbook"),
            resetLayoutChanges: l10n.t("Reset"),
            rebaseLayout: l10n.t("Rebase on current runbook"),
            layoutRevisionConflict: l10n.t(
                "The runbook layout changed after customization started. Rebase to preview these edits against the current version, or reset them.",
            ),
            layoutOverlapConflict: (count: number) =>
                l10n.t({
                    message:
                        "Rebase found {0} field conflict(s). Review the conflicting output fields, keep your values explicitly, or reset the staged changes.",
                    args: [count],
                    comment: ["{0} is the number of conflicting presentation fields"],
                }),
            layoutConflictItem: (nodeId: string, fields: string) =>
                l10n.t({
                    message: "{0}: {1}",
                    args: [nodeId, fields],
                    comment: [
                        "{0} is a runbook plan node id",
                        "{1} is a comma-separated list of conflicting presentation field identifiers",
                    ],
                }),
            layoutConflictWidgetRemoved: l10n.t("output removed"),
            layoutConflictWidgetIdentity: l10n.t("output identity"),
            layoutConflictDefaultView: l10n.t("default view"),
            layoutConflictSection: l10n.t("section"),
            layoutConflictVisibility: l10n.t("visibility"),
            layoutConflictOrder: l10n.t("order"),
            layoutConflictCompactWidth: l10n.t("compact width"),
            layoutConflictMediumWidth: l10n.t("medium width"),
            layoutConflictWideWidth: l10n.t("wide width"),
            layoutConflictMinimumHeight: l10n.t("minimum height"),
            layoutConflictPriority: l10n.t("priority"),
            layoutConflictStrategy: l10n.t("layout strategy"),
            layoutPolicy: l10n.t("Layout policy"),
            overwriteLayoutConflicts: l10n.t("Keep my conflicting values"),
            layoutPreviewFailed: l10n.t("The staged layout could not be previewed."),
            layoutSaveFailed: l10n.t(
                "The layout changed or this edit is no longer valid. Review the latest layout and try again.",
            ),
            intent: l10n.t("Intent"),
            compiledPlan: l10n.t("Compiled plan"),
            edges: l10n.t("Edges"),
            compiledV: (revision: string) =>
                l10n.t({
                    message: "compiled v{0}",
                    args: [revision],
                    comment: ["{0} is a plan revision number"],
                }),
            compiledPlanRevisionTitle: (revision: string) =>
                l10n.t({
                    message: "Compiled plan revision {0}",
                    args: [revision],
                    comment: ["{0} is a plan revision number"],
                }),
            notCompiled: l10n.t("not compiled"),
            designOnly: l10n.t("design-only"),
            designOnlyHeading: l10n.t("Design-only: capabilities required"),
            designOnlyDetail: l10n.t(
                "This workflow cannot run yet. Install activities for the capabilities below, then generate the executable plan again.",
            ),
            bindingRequired: l10n.t("binding required"),
            bindingRequiredHeading: l10n.t("Ready after binding"),
            bindingRequiredDetail: l10n.t(
                "Choose the required targets, connections, and run-time secrets before starting this plan.",
            ),
            policyBlocked: l10n.t("policy blocked"),
            policyBlockedHeading: l10n.t("Run policy blocks this plan"),
            policyBlockedDetail: l10n.t(
                "Review the denied effects or approval requirements before this plan can run.",
            ),
            incompatible: l10n.t("incompatible"),
            incompatibleHeading: l10n.t("Plan and host are incompatible"),
            incompatibleDetail: l10n.t(
                "Update the run host or activity contracts shown below, then compile the plan again.",
            ),
            previewOnly: l10n.t("deterministic preview only"),
            proposedWorkflow: l10n.t("Proposed workflow"),
            designOutlineDetail: l10n.t(
                "Review-only outline. These steps are not executable until every required activity is installed and the workflow is compiled.",
            ),
            missingCapability: l10n.t("Missing capability"),
            installedCapability: l10n.t("Installed capability"),
            targetLabel: l10n.t("Target:"),
            restrictedMode: l10n.t("restricted mode"),
            untrustedDetail: l10n.t(
                "Runbook execution is disabled in untrusted workspaces. Trust this workspace to run runbooks.",
            ),
            dismiss: l10n.t("Dismiss"),
            loading: l10n.t("Loading…"),
            invalidRunbookTitle: l10n.t("This file is not a valid runbook"),
            noIntent: l10n.t("No intent authored yet. Describe what this runbook should do."),
            notCompiledDetail: l10n.t(
                "This runbook has not been compiled. Compilation turns the intent into a typed plan of registered activities.",
            ),
            step: l10n.t("Step"),
            kind: l10n.t("Kind"),
            activity: l10n.t("Activity"),
            blastRadius: l10n.t("Blast radius"),
            parameter: l10n.t("Parameter"),
            type: l10n.t("Type"),
            required: l10n.t("Required"),
            defaultColumn: l10n.t("Default"),
            state: l10n.t("State"),
            duration: l10n.t("Duration"),
            result: l10n.t("Result"),
            output: l10n.t("Output"),
            rows: l10n.t("Rows"),
            started: l10n.t("Started"),
            planRevision: l10n.t("Plan revision"),
            yes: l10n.t("yes"),
            no: l10n.t("no"),
            rebindAtRunTime: l10n.t("(rebind at run time)"),
            detailDataExpired: l10n.t("detail data expired"),
            noParametersTitle: l10n.t("No parameters"),
            noParametersDetail: l10n.t("This runbook declares no parameters."),
            noRunTitle: l10n.t("No run yet"),
            noRunDetail: l10n.t("Bind parameters and start a run to see live progress here."),
            noCompiledPlanTitle: l10n.t("No compiled plan"),
            noResultsTitle: l10n.t("No results"),
            noResultsDetail: l10n.t(
                "Results appear here after a run completes or produces output.",
            ),
            noOutputsTitle: l10n.t("No outputs yet"),
            noOutputsDetail: l10n.t("This run has not produced any typed outputs."),
            noHistoryTitle: l10n.t("No runs recorded"),
            noHistoryDetail: l10n.t("Past runs of this runbook appear here."),
            debugPlaceholderDetail: l10n.t(
                "Replay with parameter and model overrides arrives in a later preview.",
            ),
            openDiagnostics: l10n.t("Open diagnostics"),
            value: l10n.t("Value"),
            runButton: l10n.t("Run runbook"),
            runActiveLabel: l10n.t("Run in progress…"),
            rerun: l10n.t("Rerun"),
            stepDetails: l10n.t("Details"),
            executeQuery: l10n.t("Execute query"),
            openingQueryStudio: l10n.t("Opening Query Studio…"),
            stepInputs: l10n.t("Step inputs"),
            hideStepDetails: l10n.t("Hide details"),
            statusTimeline: l10n.t("Status timeline — what happened"),
            tileSteps: l10n.t("Steps"),
            tileRows: l10n.t("Rows returned"),
            tileFailures: l10n.t("Failures"),
            tileElapsed: l10n.t("Elapsed"),
            outputLabel: l10n.t("Output:"),
            suggestedMarker: l10n.t("Suggested"),
            setByYouMarker: l10n.t("Set by you"),
            autoSuggested: l10n.t("Auto (suggested)"),
            noOutput: l10n.t("no output"),
            chooseOutputView: l10n.t("Choose output view"),
            chooseOutputViewFor: (step: string) =>
                l10n.t({
                    message: "Choose the output view for {0}",
                    args: [step],
                    comment: ["{0} is a runbook step label"],
                }),
            recommendedMarker: l10n.t("Recommended"),
            availableMarker: l10n.t("Available"),
            fallbackMarker: l10n.t("Fallback"),
            unavailableMarker: l10n.t("Unavailable"),
            viewCandidateRecommendedReason: l10n.t(
                "Best match for this step's expected output contract.",
            ),
            viewCandidateCompatibleReason: l10n.t(
                "Compatible with this step's expected output contract.",
            ),
            showAsLabel: l10n.t("Show as"),
            showAsTabs: l10n.t("Tabs"),
            showAsToggle: l10n.t("Toggle"),
            showAsSideBySide: l10n.t("Side by side"),
            showAsStacked: l10n.t("Stacked"),
            defaultViewLabel: l10n.t("Default view"),
            outputSettings: l10n.t("settings"),
            outputPageSize: l10n.t("Rows shown"),
            outputDensity: l10n.t("Density"),
            outputComfortable: l10n.t("Comfortable"),
            outputCompact: l10n.t("Compact"),
            outputOrientation: l10n.t("Orientation"),
            outputHorizontal: l10n.t("Horizontal"),
            outputVertical: l10n.t("Vertical"),
            outputSort: l10n.t("Sort"),
            outputSortValueDesc: l10n.t("Value, high to low"),
            outputSortValueAsc: l10n.t("Value, low to high"),
            outputSortCategory: l10n.t("Category"),
            outputSortNone: l10n.t("Source order"),
            outputMaxCategories: l10n.t("Maximum categories"),
            outputInterpolation: l10n.t("Line style"),
            outputLinear: l10n.t("Linear"),
            outputStep: l10n.t("Step"),
            outputAxisBaseline: l10n.t("Y-axis baseline"),
            outputAxisAuto: l10n.t("Fit data"),
            outputAxisZeroBased: l10n.t("Include zero"),
            outputCardColumns: l10n.t("Card columns"),
            outputWrapLines: l10n.t("Wrap long lines"),
            outputLivePreview: l10n.t("Live sample preview"),
            outputLivePreviewDetail: l10n.t(
                "Uses bounded typed sample data and the same renderer as Results.",
            ),
            saveOutputPresentation: l10n.t("Save output layout"),
            savingOutputPresentation: l10n.t("Saving layout…"),
            outputPresentationRevisionConflict: l10n.t(
                "This runbook's output layout changed while the editor was open. Reopen the picker to review the latest version.",
            ),
            outputPresentationSaveFailed: l10n.t(
                "The output layout could not be saved. Review the selected views and try again.",
            ),
            viewCandidateShapeReason: l10n.t(
                "Uses chartable columns when available and falls back visibly to the grid when the result shape does not match.",
            ),
            viewCandidateFallbackReason: l10n.t(
                "Universal fallback that preserves the typed output.",
            ),
            pinnedViewUnavailableReason: l10n.t(
                "This saved view no longer matches the step's expected output contract. Choose a compatible replacement or return to the suggested view.",
            ),
            useSuggestedView: l10n.t("Use suggested view"),
            usingSuggestedView: l10n.t("Using the suggested view"),
            whyTheseOptions: l10n.t("Why these options?"),
            whyTheseOptionsDetail: l10n.t(
                "Candidates come from the step's expected data contract. The actual result is validated at run time and falls back visibly if its shape changed.",
            ),
            stepsComplete: (done: number, total: number) =>
                l10n.t({
                    message: "{0} of {1} steps complete",
                    args: [done, total],
                    comment: ["{0} completed count, {1} total count"],
                }),
            readOnlyChip: l10n.t("read-only"),
            mutatingChip: l10n.t("mutating"),
            approvalChip: l10n.t("approval"),
            queuedLabel: l10n.t("Queued."),
            resultsRunPicker: l10n.t("Run:"),
            viewResults: l10n.t("View results"),
            evidenceFormat: l10n.t("Evidence format:"),
            evidenceFormatJunit: l10n.t("JUnit XML"),
            evidenceFormatSarif: l10n.t("SARIF"),
            evidenceFormatMarkdown: l10n.t("Markdown"),
            evidenceFormatJson: l10n.t("Machine JSON"),
            exportEvidence: l10n.t("Export evidence"),
            exportingEvidence: l10n.t("Exporting…"),
            waitingOn: (steps: string) =>
                l10n.t({
                    message: "Waiting on: {0}",
                    args: [steps],
                    comment: ["{0} comma-separated names of steps this one depends on"],
                }),
            eventLog: l10n.t("Event log"),
            widgetPending: l10n.t("Waiting for this step to produce output…"),
            widgetSourceMissing: l10n.t("The step this widget was bound to no longer exists."),
            emptySectionTitle: l10n.t("No results in this section"),
            emptySectionDetail: l10n.t(
                "Results will appear here when this section receives a matching output.",
            ),
            reservedSectionDetail: l10n.t("Reserved for matching results"),
            dataExpiredDetail: l10n.t(
                "The detail data for this output has expired. The run record remains available.",
            ),
            unsupportedRenderer: (view: string) =>
                l10n.t({
                    message: "The '{0}' view is not available yet in this preview.",
                    args: [view],
                    comment: ["{0} is a renderer kind id"],
                }),
            driftBadge: l10n.t("Review required"),
            driftDetail: (requested: string, actual: string) =>
                l10n.t({
                    message:
                        "The saved '{0}' view no longer matches this output. Showing '{1}' instead. Review this widget's presentation before saving the runbook.",
                    args: [requested, actual],
                    comment: ["{0} and {1} are renderer kind ids"],
                }),
            showingRows: (shown: number, total: number) =>
                l10n.t({
                    message: "Showing {0} of {1} rows.",
                    args: [shown, total],
                    comment: ["{0} and {1} are row counts"],
                }),
            showingFirstRows: (shown: number, total: number) =>
                l10n.t({
                    message: "Showing first {0} of {1} rows.",
                    args: [shown, total],
                    comment: ["{0} and {1} are row counts"],
                }),
            noNumericColumn: l10n.t(
                "This output has no numeric column to chart — showing the grid instead.",
            ),
            needsTimeColumn: l10n.t(
                "This output needs a date/time column to chart — showing the grid instead.",
            ),
            barChartLabel: (value: string, category: string) =>
                l10n.t({
                    message: "Bar chart of {0} by {1}",
                    args: [value, category],
                    comment: ["{0} is a value column name, {1} is a category column name"],
                }),
            timeseriesLabel: (value: string, time: string) =>
                l10n.t({
                    message: "Line chart of {0} over {1}",
                    args: [value, time],
                    comment: ["{0} is a value column name, {1} is a date/time column name"],
                }),
            rowCount: (count: number) =>
                l10n.t({
                    message: "{0} rows",
                    args: [count],
                    comment: ["{0} is a row count"],
                }),
            seriesPointLabel: (series: string, value: string, at: string) =>
                l10n.t({
                    message: "{0}: {1} at {2}",
                    args: [series, value, at],
                    comment: [
                        "{0} is a series (column) name, {1} is a numeric value, {2} is an x-axis position (a date/time or a number)",
                    ],
                }),
            categorySeriesValue: (category: string, series: string, value: string) =>
                l10n.t({
                    message: "{0} — {1}: {2}",
                    args: [category, series, value],
                    comment: [
                        "{0} is a category name, {1} is a series (column) name, {2} is a numeric value",
                    ],
                }),
            modifiedChip: l10n.t("modified"),
            resetViewTitle: l10n.t("Reset to the default view (this run only)"),
            saveViewAsRunbookDefault: l10n.t("Save as runbook default"),
            savingViewAsRunbookDefault: l10n.t("Saving default…"),
            saveViewAsRunbookDefaultFailed: l10n.t(
                "The runbook default could not be saved. The selected view still applies to this run only.",
            ),
            viewSwitcherLabel: (title: string) =>
                l10n.t({
                    message: "View for {0}",
                    args: [title],
                    comment: ["{0} is a result widget title"],
                }),
            describeHeading: l10n.t("What should this runbook do?"),
            describePlaceholder: l10n.t(
                'Describe the check, validation, or investigation in plain language — e.g. "verify the Orders table has no rows with a NULL customer id and stays under 1M rows".',
            ),
            currentCapabilitiesLabel: l10n.t("Executable today:"),
            currentCapabilitiesDetail: l10n.t(
                "Read-only SQL validation and investigation runbooks. Build, schema-change, deployment, benchmark, and CI/CD prompts can help shape a draft, but cannot run until their typed activities and a headless runner are installed.",
            ),
            generatePlan: l10n.t("Generate plan"),
            regeneratePlan: l10n.t("Regenerate plan"),
            generating: l10n.t("Generating plan…"),
            liveThinking: l10n.t("Live thinking"),
            workflowSteps: l10n.t("Workflow steps"),
            generationConsoleAria: l10n.t("Plan generation console"),
            toolCallCount: (count: number) =>
                l10n.t({
                    message: "{0} tool calls",
                    args: [count],
                    comment: ["{0} is a count of tool invocations"],
                }),
            inputsChipLabel: l10n.t("Inputs:"),
            consoleWorking: l10n.t("working"),
            modelChip: (modelId: string) =>
                l10n.t({
                    message: "model {0}",
                    args: [modelId],
                    comment: ["{0} is a model identifier"],
                }),
            workingElapsed: (seconds: number) =>
                l10n.t({
                    message: "Working — {0}s elapsed",
                    args: [seconds],
                    comment: ["{0} is a whole number of seconds"],
                }),
            planGeneratedIn: (elapsed: string) =>
                l10n.t({
                    message: "Plan generated in {0}",
                    args: [elapsed],
                    comment: ["{0} is an elapsed time like 1m 43s"],
                }),
            planGenerationFailed: l10n.t("Plan generation did not complete"),
            showGenerationDetails: l10n.t("Generation details"),
            tryExample: l10n.t("Try an example:"),
            exampleRowCount: l10n.t("Warn me when a table grows past a limit"),
            exampleOrphans: l10n.t("Check a table for orphaned rows"),
            exampleFreshness: l10n.t("Verify data was loaded today"),
            exampleRowCountIntent: l10n.t(
                "Check that the dbo.Orders table stays under 1,000,000 rows and fail the run if it does not.",
            ),
            exampleOrphansIntent: l10n.t(
                "Verify there are no OrderItems rows whose OrderId does not exist in the Orders table; fail if any orphans are found.",
            ),
            exampleFreshnessIntent: l10n.t(
                "Verify that the dbo.ImportLog table has at least one row created today; fail the run if the last import is older than one day.",
            ),
            planReady: l10n.t("Plan ready — bind parameters and run it."),
            continueToParameters: l10n.t("Continue to Parameters"),
            stepDescribe: l10n.t("Describe"),
            stepGenerate: l10n.t("Generate"),
            stepBindRun: l10n.t("Bind & run"),
            approvalRequired: l10n.t("Approval required"),
            approve: l10n.t("Approve"),
            reject: l10n.t("Reject"),
            cancelRun: l10n.t("Cancel run"),
            cancelGeneration: l10n.t("Cancel generation"),
            runStatus: l10n.t("Run status"),
            selectConnection: l10n.t("Select a connection…"),
            noSavedConnections: l10n.t(
                "No saved connections. Add one in the SQL Server view first — runbooks bind to saved connection profiles.",
            ),
            onFailure: (target: string) =>
                l10n.t({
                    message: "on failure → {0}",
                    args: [target],
                    comment: ["{0} is a plan step name"],
                }),
            onRejected: (target: string) =>
                l10n.t({
                    message: "if rejected → {0}",
                    args: [target],
                    comment: ["{0} is a plan step name"],
                }),
            viewList: l10n.t("List"),
            viewGraph: l10n.t("Graph"),
            planViewLabel: l10n.t("Plan view"),
            graphAriaSummary: (steps: number, edgeCount: number) =>
                l10n.t({
                    message: "Workflow graph: {0} steps, {1} edges",
                    args: [steps, edgeCount],
                    comment: ["{0} is a step count, {1} is an edge count"],
                }),
        };
    }
}

export let locConstants = LocConstants.getInstance();
