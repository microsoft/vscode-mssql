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
            apply: l10n.t("Apply"),
            next: l10n.t("Next"),
            clearSelection: l10n.t("Clear Selection"),
            clear: l10n.t("Clear"),
            find: l10n.t("Find"),
            findNext: l10n.t("Find Next"),
            findPrevious: l10n.t("Find Previous"),
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
            dismiss: l10n.t("Dismiss"),
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
            property: l10n.t("Property"),
            operator: l10n.t("Operator"),
            value: l10n.t("Value"),
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
            youMustReviewAndAccept: l10n.t("You must review and accept the terms to proceed"),
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
            tenant: l10n.t("Tenant"),
            ruleName: l10n.t("Rule name"),
            addMyClientIp: (ipAddress: string) =>
                l10n.t({
                    message: "Add my client IP ({0})",
                    args: [ipAddress],
                    comment: ["{0} is the IP address of the client"],
                }),
            addMySubnetRange: "Add my subnet IP range",
        };
    }

    public get connectionDialog() {
        return {
            searchWorkspaces: l10n.t("Search workspaces..."),
            loadingFabricAccounts: l10n.t("Loading Fabric Accounts"),
            fabricAccount: l10n.t("Fabric Account"),
            selectAnAccount: l10n.t("Select an account"),
            account: l10n.t("Account"),
            signIn: l10n.t("Sign In"),
            tenantId: l10n.t("Tenant ID"),
            authenticationType: l10n.t("Authentication Type"),
            browseBy: l10n.t("Browse By"),
            myData: l10n.t("My Data"),
            recent: l10n.t("Recent"),
            favorites: l10n.t("Favorites"),
            workspaces: l10n.t("Workspaces"),
            signIntoFabric: l10n.t("Sign into Fabric"),
            filterByKeyword: l10n.t("Filter by keyword"),
            filter: l10n.t("Filter"),
            filterByType: l10n.t("Filter by type"),
            showAll: l10n.t("Show All"),
            sqlAnalyticsEndpoint: l10n.t("SQL Analytics Endpoint"),
            sqlDatabase: l10n.t("SQL Database"),
            noWorkspacesAvailable: l10n.t("No workspaces available"),
            nameColumnHeader: l10n.t("Name"),
            typeColumnHeader: l10n.t("Type"),
            locationColumnHeader: l10n.t("Location (Workspace)"),
            expandWorkspaceExplorer: l10n.t("Expand Workspace Explorer"),
            expand: l10n.t("Expand"),
            explorer: l10n.t("Explorer"),
            collapseWorkspaceExplorer: l10n.t("Collapse Workspace Explorer"),
            collapse: l10n.t("Collapse"),
            noWorkspacesFound: l10n.t(
                "No workspaces found. Please change Fabric account or tenant to view available workspaces.",
            ),
            noDatabasesFoundInWorkspace: (workspaceName?: string) => {
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
            advancedConnectionSettings: l10n.t("Advanced Connection Settings"),
            advancedSettings: l10n.t("Advanced"),
            testConnection: l10n.t("Test Connection"),
            connectToDatabase: l10n.t("Connect to Database"),
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
            removeRecentConnection: l10n.t("Remove recent connection"),
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
            loadingWorkspaces: l10n.t("Loading workspaces..."),
            loadingDatabasesInWorkspace: (workspaceName?: string) => {
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
            errorLoadingWorkspaces: l10n.t("Error loading workspaces"),
            errorLoadingDatabases: l10n.t("Error loading databases"),
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
            privacyStatement: l10n.t("Privacy Statement"),
            feedbackStatementShort: l10n.t(
                "Microsoft will process the feedback you submit pursuant to your organization’s instructions in order to improve your and your organization’s experience with this product. If you have any questions...",
            ),
            feedbackStatementLong: l10n.t(
                "Microsoft will process the feedback you submit pursuant to your organization’s instructions in order to improve your and your organization’s experience with this product. If you have any questions about the use of feedback data, please contact your tenant administrator. Processing of feedback data is governed by the Microsoft Products and Services Data Protection Addendum between your organization and Microsoft, and the feedback you submit is considered Personal Data under that addendum.",
            ),
        };
    }

    public get queryResult() {
        return {
            results: (count: number) =>
                l10n.t({
                    message: "Results ({0})",
                    args: [count],
                    comment: ["{0} is the number of results"],
                }),
            messages: l10n.t("Messages"),
            timestamp: l10n.t("Timestamp"),
            message: l10n.t("Message"),
            openResultInNewTab: l10n.t("Open in New Tab"),
            showplanXML: l10n.t("Showplan XML"),
            showFilter: l10n.t("Show Filter"),
            sortAscending: l10n.t("Sort Ascending"),
            sortDescending: l10n.t("Sort Descending"),
            clearSort: l10n.t("Clear Sort"),
            saveAsCsv: l10n.t("Save as CSV"),
            saveAsExcel: l10n.t("Save as Excel"),
            saveAsJson: l10n.t("Save as JSON"),
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
            gridView: l10n.t("Grid View"),
            textView: l10n.t("Text View"),
            toggleToGridView: l10n.t("Switch to Grid View"),
            toggleToTextView: l10n.t("Switch to Text View"),
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
            resultSet: (index: string) =>
                l10n.t({
                    message: "Result Set {0}",
                    args: [index],
                    comment: ["{0} is the index of the result set"],
                }),
            loadingTextView: l10n.t("Loading text view..."),
            noResultsHeader: l10n.t("No results for the active editor"),
            noResultMessage: l10n.t(
                "Run a query in the current editor, or switch to an editor that has results.",
            ),
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
            publishChanges: l10n.t("Publish Changes"),
            editTable: l10n.t("Edit Table"),
            openInEditor: l10n.t("Open in Editor"),
            changedTables: l10n.t("Changed Tables"),
            createAsScript: l10n.t("Create As Script"),
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
            dataTierApplicationFile: l10n.t("Data-tier Application File (.dacpac)"),
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

    public get containerDeployment() {
        return {
            loadingDeploymentPage: l10n.t("Loading deployment page..."),
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
                "Pick from multiple SQL Server versions, including SQL Server 2025 (Preview) with built-in AI capabilities like vector search and JSON enhancements.",
            ),
            learnMoreAboutSqlServer2025: l10n.t("Learn more about SQL Server 2025 features"),
            sqlServerEditionsComparison: l10n.t("Compare SQL Server editions"),
            configureAndCustomizeSqlServer: l10n.t("Configure and customize SQL Server containers"),
            getStarted: l10n.t("Get Started"),
            gettingDockerReady: l10n.t("Getting Docker Ready..."),
            checkingPrerequisites: l10n.t("Checking pre-requisites"),
            advancedOptions: l10n.t("Advanced Options"),
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
}

export let locConstants = LocConstants.getInstance();
