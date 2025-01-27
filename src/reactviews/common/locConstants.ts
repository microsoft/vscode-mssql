/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from "@vscode/l10n";

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
        };
    }

    public get objectExplorerFiltering() {
        return {
            error: l10n.t("Error"),
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
                    comment: [
                        "{0} is the path of the node in the object explorer",
                    ],
                }),
            firstValueEmptyError: (operator: string, filterName: string) =>
                l10n.t({
                    message:
                        "The first value must be set for the {0} operator in the {1} filter",
                    args: [operator, filterName],
                    comment: [
                        "{0} is the operator for the filter",
                        "{1} is the name of the filter",
                    ],
                }),
            secondValueEmptyError: (operator: string, filterName: string) =>
                l10n.t({
                    message:
                        "The second value must be set for the {0} operator in the {1} filter",
                    args: [operator, filterName],
                    comment: [
                        "{0} is the operator for the filter",
                        "{1} is the name of the filter",
                    ],
                }),
            firstValueLessThanSecondError: (
                operator: string,
                filterName: string,
            ) =>
                l10n.t({
                    message:
                        "The first value must be less than the second value for the {0} operator in the {1} filter",
                    args: [operator, filterName],
                    comment: [
                        "{0} is the operator for the filter",
                        "{1} is the name of the filter",
                    ],
                }),
            property: l10n.t("Property"),
            operator: l10n.t("Operator"),
            value: l10n.t("Value"),
            clear: l10n.t("Clear"),
        };
    }

    public get tableDesigner() {
        return {
            publishingChanges: l10n.t("Publishing Changes"),
            changesPublishedSuccessfully: l10n.t(
                "Changes published successfully",
            ),
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
            errorLoadingDesigner: l10n.t("Error loading designer"),
            severity: l10n.t("Severity"),
            description: l10n.t("Description"),
            scriptAsCreate: l10n.t("Script As Create"),
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
            youMustReviewAndAccept: l10n.t(
                "You must review and accept the terms to proceed",
            ),
        };
    }

    public get connectionDialog() {
        return {
            connect: l10n.t("Connect"),
            advancedConnectionSettings: l10n.t("Advanced Connection Settings"),
            advancedSettings: l10n.t("Advanced"),
            testConnection: l10n.t("Test Connection"),
            connectToSQLServer: l10n.t("Connect to SQL Server"),
            parameters: l10n.t("Parameters"),
            connectionString: l10n.t("Connection String"),
            browseAzure: l10n.t("Browse Azure"),
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
            enableTrustServerCertificateButton: l10n.t(
                "Enable 'Trust Server Certificate'",
            ),
            createNewFirewallRule: l10n.t("Create a new firewall rule"),
            firewallRuleNeededMessage: l10n.t(
                "A firewall rule is required to access this server.",
            ),
            addFirewallRule: l10n.t("Add Firewall Rule"),
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
            removeRecentConnection: l10n.t("Remove recent connection"),
        };
    }

    public get executionPlan() {
        return {
            queryCostRelativeToScript: (
                index: number,
                costPercentage: string,
            ) =>
                l10n.t({
                    message:
                        "Query {0}:  Query cost (relative to the script):  {1}%",
                    args: [index, costPercentage],
                    comment: [
                        "{0} is the query number",
                        "{1} is the query cost",
                    ],
                }),
            equals: l10n.t("Equals"),
            contains: l10n.t("Contains"),
            actualElapsedTime: l10n.t("Actual Elapsed Time"),
            actualElapsedCpuTime: l10n.t("Actual Elapsed CPU Time"),
            cost: l10n.t("Cost"),
            subtreeCost: l10n.t("Subtree Cost"),
            actualNumberOfRowsForAllExecutions: l10n.t(
                "Actual Number of Rows For All Executions",
            ),
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
            highlightExpensiveOperation: l10n.t(
                "Highlight Expensive Operation",
            ),
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
        };
    }

    public get userFeedback() {
        return {
            microsoftWouldLikeYourFeedback: l10n.t(
                "Microsoft would like your feedback",
            ),
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
            privacyStatement: l10n.t("Privacy Statement"),
        };
    }

    public get queryResult() {
        return {
            results: l10n.t("Results"),
            messages: l10n.t("Messages"),
            timestamp: l10n.t("Timestamp"),
            message: l10n.t("Message"),
            openResultInNewTab: l10n.t("Open in New Tab"),
            showplanXML: l10n.t("Showplan XML"),
            showFilter: l10n.t("Show Filter"),
            sortAscending: l10n.t("Sort Ascending"),
            sortDescending: l10n.t("Sort Descending"),
            saveAsCsv: l10n.t("Save as CSV"),
            saveAsExcel: l10n.t("Save as Excel"),
            saveAsJson: l10n.t("Save as JSON"),
            noResultMessage: l10n.t(
                "No result found for the active editor; please run a query or switch to another editor.",
            ),
            clickHereToHideThisPanel: l10n.t("Hide this panel"),
            queryPlan: l10n.t("Query Plan"),
            selectAll: l10n.t("Select All"),
            copy: l10n.t("Copy"),
            copyWithHeaders: l10n.t("Copy with Headers"),
            copyHeaders: l10n.t("Copy Headers"),
            null: l10n.t("NULL"),
            blankString: l10n.t("Blanks"),
            apply: l10n.t("Apply"),
            clear: l10n.t("Clear"),
            search: l10n.t("Search..."),
            close: l10n.t("Close"),
            maximize: l10n.t("Maximize"),
            restore: l10n.t("Restore"),
        };
    }
}

export let locConstants = LocConstants.getInstance();
