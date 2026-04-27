/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import * as chai from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as Constants from "../../src/constants/constants";
import {
    buildCompletionRules,
    detectIntentComment,
    intentModeMaxTokens,
    sanitizeInlineCompletionText,
    SqlInlineCompletionProvider,
} from "../../src/copilot/sqlInlineCompletionProvider";
import { inlineCompletionDebugStore } from "../../src/copilot/inlineCompletionDebug/inlineCompletionDebugStore";
import { SqlInlineCompletionSchemaContextService } from "../../src/copilot/sqlInlineCompletionSchemaContextService";
import { createTestDocument, stubTelemetry } from "./utils";

chai.use(sinonChai);

suite("SqlInlineCompletionProvider Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let schemaContextService: sinon.SinonStubbedInstance<SqlInlineCompletionSchemaContextService>;
    let provider: SqlInlineCompletionProvider;
    let extensionContext: vscode.ExtensionContext;
    let sendRequestStub: sinon.SinonStub;
    let countTokensStub: sinon.SinonStub;
    let experimentalFeaturesEnabled: boolean;
    let inlineCompletionFeatureEnabled: boolean;
    let configuredProfile: string | undefined;
    let configuredModelFamily: string;
    let enabledCategories: string[];

    setup(() => {
        sandbox = sinon.createSandbox();
        stubTelemetry(sandbox);
        experimentalFeaturesEnabled = true;
        inlineCompletionFeatureEnabled = true;
        configuredProfile = "balanced";
        configuredModelFamily = "";
        enabledCategories = ["continuation", "intent"];

        schemaContextService = sandbox.createStubInstance(SqlInlineCompletionSchemaContextService);
        extensionContext = {
            subscriptions: [],
            languageModelAccessInformation: {
                canSendRequest: sandbox.stub().returns(true),
            },
        } as unknown as vscode.ExtensionContext;

        sandbox.stub(vscode.workspace, "getConfiguration").callsFake((section?: string) => {
            return {
                get: sandbox.stub().callsFake((key: string, defaultValue?: unknown) => {
                    if (section === "mssql" && key === "enableExperimentalFeatures") {
                        return experimentalFeaturesEnabled;
                    }

                    if (key === Constants.configCopilotInlineCompletionsUseSchemaContext) {
                        return inlineCompletionFeatureEnabled;
                    }

                    if (key === Constants.configCopilotInlineCompletionsProfile) {
                        return configuredProfile === undefined ? defaultValue : configuredProfile;
                    }

                    if (key === Constants.configCopilotInlineCompletionsModelFamily) {
                        return configuredModelFamily;
                    }

                    if (key === Constants.configCopilotInlineCompletionsEnabledCategories) {
                        return enabledCategories;
                    }

                    return defaultValue;
                }),
            } as unknown as vscode.WorkspaceConfiguration;
        });

        sendRequestStub = sandbox.stub().resolves(createChatResponse("FROM dbo.Customers"));
        countTokensStub = sandbox.stub().callsFake(async (value: unknown) => {
            return typeof value === "string" ? 3 : 10;
        });
        sandbox.stub(vscode.lm, "selectChatModels").resolves([
            {
                id: "claude-haiku-4.5",
                family: "claude-haiku-4.5",
                vendor: "copilot",
                sendRequest: sendRequestStub,
                countTokens: countTokensStub,
            } as unknown as vscode.LanguageModelChat,
        ]);

        provider = new SqlInlineCompletionProvider(extensionContext, schemaContextService);
    });

    teardown(() => {
        provider.dispose();
        inlineCompletionDebugStore.clearEvents();
        inlineCompletionDebugStore.setPanelOpen(false);
        inlineCompletionDebugStore.replaceOverrides({
            profileId: null,
            modelSelector: null,
            continuationModelSelector: null,
            useSchemaContext: null,
            includeSqlDiagnostics: null,
            debounceMs: null,
            maxTokens: null,
            enabledCategories: null,
            forceIntentMode: null,
            customSystemPrompt: null,
            allowAutomaticTriggers: null,
        });
        sandbox.restore();
    });

    test("includes active editor schema context in the language model prompt", async () => {
        schemaContextService.getSchemaContext.resolves({
            server: "localhost",
            database: "Sales",
            defaultSchema: "dbo",
            totalTableCount: 18,
            schemas: ["dbo", "sales"],
            tables: [{ name: "dbo.Customers", columns: ["CustomerId", "Name"] }],
            views: [],
            tableNameOnlyInventory: ["sales.Orders", "sales.Invoices"],
            masterSymbols: ["sys.databases"],
        });

        const items = await provider.provideInlineCompletionItems(
            createTestDocument("SELECT *", "file:///query.sql"),
            new vscode.Position(0, "SELECT *".length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect(items).to.have.lengthOf(1);
        // FROM is a clause keyword — fixLeadingWhitespace prepends a newline because the line
        // prefix ends with a non-whitespace character ("*").
        expect((items as vscode.InlineCompletionItem[])[0].insertText).to.equal(
            "\nFROM dbo.Customers",
        );

        const userMessageText = getMessageText(sendRequestStub.firstCall.args[0][1]);
        expect(userMessageText).to.include("-- connection: localhost / Sales");
        expect(userMessageText).to.include("TABLE dbo.Customers (CustomerId, Name)");
        expect(userMessageText).to.include("-- user tables: detailed 1 of 18");
        expect(userMessageText).to.include("TABLE NAMES sales (Orders, Invoices)");
        expect(userMessageText).to.include("-- master symbols: sys.databases");
    });

    test("sends instructions as first message and document context as second message", async () => {
        schemaContextService.getSchemaContext.resolves(undefined);
        sendRequestStub.resolves(createChatResponse("1"));

        await provider.provideInlineCompletionItems(
            createTestDocument("SELECT *", "file:///query.sql"),
            new vscode.Position(0, "SELECT *".length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        const messages: vscode.LanguageModelChatMessage[] = sendRequestStub.firstCall.args[0];
        expect(messages).to.have.lengthOf(2);
        expect(messages[0].role).to.equal(vscode.LanguageModelChatMessageRole.User);
        expect(messages[1].role).to.equal(vscode.LanguageModelChatMessageRole.User);
        expect(getMessageText(messages[0])).to.include(
            "Return only the text to insert at the cursor",
        );
        expect(getMessageText(messages[1])).to.include("<current_statement_prefix>");
    });

    test("falls back to prompting without schema context when metadata is unavailable", async () => {
        schemaContextService.getSchemaContext.resolves(undefined);
        sendRequestStub.resolves(createChatResponse("WHERE 1 = 1"));

        const items = await provider.provideInlineCompletionItems(
            createTestDocument("SELECT * FROM dbo.Customers", "file:///query.sql"),
            new vscode.Position(0, "SELECT * FROM dbo.Customers".length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect(items).to.have.lengthOf(1);
        // WHERE is a clause keyword; linePrefix ends with "s" — fixLeadingWhitespace adds a newline.
        expect((items as vscode.InlineCompletionItem[])[0].insertText).to.equal("\nWHERE 1 = 1");

        const userMessageText = getMessageText(sendRequestStub.firstCall.args[0][1]);
        expect(userMessageText).to.include("<schema_context>\n-- unavailable\n</schema_context>");
    });

    test("prepends a newline when the model omits it before a clause keyword", async () => {
        schemaContextService.getSchemaContext.resolves(undefined);

        for (const keyword of ["WHERE", "JOIN", "GROUP BY", "ORDER BY", "HAVING"]) {
            sendRequestStub.resolves(createChatResponse(`${keyword} x = 1`));

            const items = await provider.provideInlineCompletionItems(
                // Line prefix ends with non-whitespace ("s")
                createTestDocument("SELECT * FROM dbo.Customers", "file:///query.sql"),
                new vscode.Position(0, "SELECT * FROM dbo.Customers".length),
                {
                    triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
                } as vscode.InlineCompletionContext,
                { isCancellationRequested: false } as vscode.CancellationToken,
            );

            expect((items as vscode.InlineCompletionItem[])[0].insertText).to.equal(
                `\n${keyword} x = 1`,
                `Expected newline before ${keyword}`,
            );
        }
    });

    test("prepends a space when the model omits it before a non-clause continuation", async () => {
        schemaContextService.getSchemaContext.resolves(undefined);
        // Model returns a column alias with no leading space
        sendRequestStub.resolves(createChatResponse("AS CustomerName"));

        const items = await provider.provideInlineCompletionItems(
            // linePrefix ends with "d" — non-whitespace
            createTestDocument("SELECT CustomerId", "file:///query.sql"),
            new vscode.Position(0, "SELECT CustomerId".length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect((items as vscode.InlineCompletionItem[])[0].insertText).to.equal(" AS CustomerName");
    });

    test("recovers a dropped dot when the model omits it for a known qualified name", async () => {
        // Schema context contains "sys.databases" in masterSymbols. The model returns
        // "databases" (no dot) after the user has typed "sys". fixLeadingWhitespace should
        // detect the match and prepend "." rather than " ".
        schemaContextService.getSchemaContext.resolves({
            server: "localhost",
            database: "master",
            defaultSchema: "dbo",
            schemas: ["dbo"],
            tables: [],
            views: [],
            masterSymbols: ["sys.databases", "sys.server_principals"],
        });
        sendRequestStub.resolves(createChatResponse("databases"));

        const items = await provider.provideInlineCompletionItems(
            createTestDocument("SELECT * FROM sys", "file:///query.sql"),
            new vscode.Position(0, "SELECT * FROM sys".length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect((items as vscode.InlineCompletionItem[])[0].insertText).to.equal(".databases");
    });

    test("does not add a space after a dot when completing a qualified identifier", async () => {
        schemaContextService.getSchemaContext.resolves(undefined);
        // User typed "sys." — model correctly returns "databases" (no dot needed).
        // fixLeadingWhitespace must not insert a space and produce "sys. databases".
        sendRequestStub.resolves(createChatResponse("databases"));

        const items = await provider.provideInlineCompletionItems(
            createTestDocument("SELECT * FROM sys.", "file:///query.sql"),
            new vscode.Position(0, "SELECT * FROM sys.".length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect((items as vscode.InlineCompletionItem[])[0].insertText).to.equal("databases");
    });

    test("does not add leading whitespace when the line prefix already ends with a space", async () => {
        schemaContextService.getSchemaContext.resolves(undefined);
        sendRequestStub.resolves(createChatResponse("dbo.Customers"));

        const items = await provider.provideInlineCompletionItems(
            // linePrefix ends with a space — no fix needed
            createTestDocument("SELECT * FROM ", "file:///query.sql"),
            new vscode.Position(0, "SELECT * FROM ".length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect((items as vscode.InlineCompletionItem[])[0].insertText).to.equal("dbo.Customers");
    });

    test("starts a new statement on the next line when cursor follows a semicolon and spaces", async () => {
        schemaContextService.getSchemaContext.resolves(undefined);
        sendRequestStub.resolves(createChatResponse("SELECT session_id"));

        const text = "SELECT * FROM sys.dm_exec_sessions\nORDER BY login_time; ";
        const items = await provider.provideInlineCompletionItems(
            createTestDocument(text, "file:///query.sql"),
            new vscode.Position(1, "ORDER BY login_time; ".length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect((items as vscode.InlineCompletionItem[])[0].insertText).to.equal(
            "\nSELECT session_id",
        );
    });

    test("places completion directly on a blank line without any leading newline", async () => {
        // Cursor is at column 0 on an empty line 2. The model returns a clause keyword.
        // fixLeadingWhitespace must NOT prepend \n — the cursor is already on the right line.
        schemaContextService.getSchemaContext.resolves(undefined);
        sendRequestStub.resolves(createChatResponse("WHERE database_id = 1"));

        const doc = createTestDocument("select *\nfrom sys.databases\n", "file:///query.sql");
        const items = await provider.provideInlineCompletionItems(
            doc,
            new vscode.Position(2, 0), // blank line 2, column 0
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect((items as vscode.InlineCompletionItem[])[0].insertText).to.equal(
            "WHERE database_id = 1",
        );
    });

    test("places completion directly when cursor follows only indentation whitespace", async () => {
        schemaContextService.getSchemaContext.resolves(undefined);
        sendRequestStub.resolves(createChatResponse("WHERE database_id = 1"));

        const doc = createTestDocument("select *\nfrom sys.databases\n    ", "file:///query.sql");
        const items = await provider.provideInlineCompletionItems(
            doc,
            new vscode.Position(2, 4), // indented blank, cursor after "    "
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect((items as vscode.InlineCompletionItem[])[0].insertText).to.equal(
            "WHERE database_id = 1",
        );
    });

    test("includes recent completed statements so continuation mode can avoid duplicate declarations", async () => {
        schemaContextService.getSchemaContext.resolves(undefined);
        sendRequestStub.resolves(createChatResponse(""));

        const documentText = [
            "DECLARE @start_time datetime = DATEADD(DAY, -1, GETDATE());",
            "DECLARE @end_time datetime = GETDATE(); ",
            "",
            "SELECT",
            "    qs.sql_handle",
            "FROM sys.dm_exec_query_stats qs",
            "WHERE qs.last_execution_time BETWEEN @start_time AND @end_time",
        ].join("\n");

        await provider.provideInlineCompletionItems(
            createTestDocument(documentText, "file:///query.sql"),
            new vscode.Position(1, "DECLARE @end_time datetime = GETDATE(); ".length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        const userMessageText = getMessageText(sendRequestStub.firstCall.args[0][1]);
        expect(userMessageText).to.include(
            "<recent_document_prefix>\nDECLARE @start_time datetime = DATEADD(DAY, -1, GETDATE());",
        );
        expect(userMessageText).to.include(
            "<current_line_prefix>\nDECLARE @end_time datetime = GETDATE(); ",
        );
        expect(userMessageText).to.include("<document_suffix>");
        expect(userMessageText).to.include("SELECT\n    qs.sql_handle");
    });

    test("suppresses model rewrites that are highly similar to the document suffix", async () => {
        schemaContextService.getSchemaContext.resolves(undefined);
        sendRequestStub.resolves(
            createChatResponse(`SELECT
    qs.sql_handle,
    qs.plan_handle,
    qs.execution_count,
    qs.total_worker_time,
    st.text
FROM sys.dm_exec_query_stats AS qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) AS st
ORDER BY qs.execution_count DESC`),
        );

        const documentText = `-- Determining your most-recompiled queries
 SELECT
    qs.sql_handle,
    qs.execution_count,
    qs.total_worker_time,
    st.text
FROM sys.dm_exec_query_stats AS qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) AS st
ORDER BY qs.execution_count DESC`;

        const items = await provider.provideInlineCompletionItems(
            createTestDocument(documentText, "file:///query.sql"),
            new vscode.Position(1, 0),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect(items).to.deep.equal([]);
    });

    test("suppresses continuation-mode prose that echoes the empty-string instruction", async () => {
        schemaContextService.getSchemaContext.resolves(undefined);
        sendRequestStub.resolves(
            createChatResponse("The document is already complete. Return empty string."),
        );

        const items = await provider.provideInlineCompletionItems(
            createTestDocument(
                `-- what are the cached plans in this database
SELECT
    qs.plan_handle,
    qp.query_plan
FROM sys.dm_exec_query_stats AS qs
CROSS APPLY sys.dm_exec_query_plan(qs.plan_handle) AS qp
ORDER BY qs.total_worker_time DESC;`,
                "file:///query.sql",
            ),
            new vscode.Position(6, "ORDER BY qs.total_worker_time DESC;".length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect(items).to.deep.equal([]);
    });

    test("applies max token override as both model option and local output budget", async () => {
        inlineCompletionDebugStore.updateOverrides({ maxTokens: 10 });
        schemaContextService.getSchemaContext.resolves(undefined);
        sendRequestStub.resolves(
            createChatResponse(
                "SELECT first_column, second_column, third_column, fourth_column FROM dbo.Customers",
            ),
        );

        const items = await provider.provideInlineCompletionItems(
            createTestDocument("", "file:///query.sql"),
            new vscode.Position(0, 0),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        const requestOptions = sendRequestStub.firstCall.args[1];
        expect(requestOptions.modelOptions.maxTokens).to.equal(10);
        expect(requestOptions.modelOptions.max_tokens).to.equal(10);
        expect(
            String((items as vscode.InlineCompletionItem[])[0].insertText).length,
        ).to.be.lessThan(61);
    });

    test("records token counts for debug events when the selected model supports countTokens", async () => {
        inlineCompletionDebugStore.setPanelOpen(true);
        schemaContextService.getSchemaContext.resolves(undefined);
        sendRequestStub.resolves(createChatResponse("FROM dbo.Customers"));

        await provider.provideInlineCompletionItems(
            createTestDocument("SELECT *", "file:///query.sql"),
            new vscode.Position(0, "SELECT *".length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        const event = inlineCompletionDebugStore.getEvents()[0];
        expect(event.inputTokens).to.equal(20);
        expect(event.outputTokens).to.equal(3);
        expect(event.completionCategory).to.equal("continuation");
    });

    test("skips continuation requests inside comments without calling the language model", async () => {
        inlineCompletionDebugStore.setPanelOpen(true);

        const line = "-- whar";
        const items = await provider.provideInlineCompletionItems(
            createTestDocument(line, "file:///query.sql"),
            new vscode.Position(0, line.length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect(items).to.deep.equal([]);
        expect(sendRequestStub).to.not.have.been.called;

        const event = inlineCompletionDebugStore.getEvents()[0];
        expect(event.result).to.equal("skipped");
        expect(event.modelId).to.equal("claude-haiku-4.5");
        expect(event.modelFamily).to.equal("claude-haiku-4.5");
        expect(event.modelVendor).to.equal("copilot");
        expect(event.inputTokens).to.equal(0);
        expect(event.outputTokens).to.equal(0);
        expect(event.locals.languageModelRequestSent).to.equal(false);
        expect(event.locals.skipReason).to.equal("continuationInComment");
    });

    test("skips automatic continuations immediately after accepting an intent completion", async () => {
        inlineCompletionDebugStore.setPanelOpen(true);
        inlineCompletionDebugStore.updateOverrides({ debounceMs: 0 });
        schemaContextService.getSchemaContext.resolves(undefined);
        sendRequestStub.resolves(createChatResponse("SELECT CustomerID\nFROM dbo.Customers;"));

        const intentItems = await provider.provideInlineCompletionItems(
            createTestDocument("-- which customers?\n", "file:///query.sql"),
            new vscode.Position(1, 0),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        const acceptCommand = (intentItems as vscode.InlineCompletionItem[])[0].command;
        await vscode.commands.executeCommand(
            acceptCommand!.command,
            ...(acceptCommand!.arguments ?? []),
        );
        sendRequestStub.resetHistory();

        const acceptedDocument = createTestDocument(
            "-- which customers?\nSELECT CustomerID\nFROM dbo.Customers;",
            "file:///query.sql",
        );
        const continuationItems = await provider.provideInlineCompletionItems(
            acceptedDocument,
            new vscode.Position(2, "FROM dbo.Customers;".length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Automatic,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect(continuationItems).to.deep.equal([]);
        expect(sendRequestStub).to.not.have.been.called;

        const event = inlineCompletionDebugStore.getEvents().at(-1)!;
        expect(event.result).to.equal("skipped");
        expect(event.inputTokens).to.equal(0);
        expect(event.outputTokens).to.equal(0);
        expect(event.locals.languageModelRequestSent).to.equal(false);
        expect(event.locals.skipReason).to.equal("continuationAfterAcceptedIntent");
    });

    test("includes nearby SQL error diagnostics in the prompt without full paths", async () => {
        const diagnostic = new vscode.Diagnostic(
            new vscode.Range(new vscode.Position(0, 7), new vscode.Position(0, 13)),
            "Incorrect syntax near 'GROUP BY' in C:\\Users\\karlb\\secret\\query.sql.",
            vscode.DiagnosticSeverity.Error,
        );
        diagnostic.code = "SQL102";
        const getDiagnosticsStub = sandbox.stub(
            vscode.languages,
            "getDiagnostics",
        ) as unknown as sinon.SinonStub<[vscode.Uri], vscode.Diagnostic[]>;
        getDiagnosticsStub.returns([diagnostic]);
        schemaContextService.getSchemaContext.resolves(undefined);

        await provider.provideInlineCompletionItems(
            createTestDocument("SELECT ", "file:///query.sql"),
            new vscode.Position(0, "SELECT ".length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        const userMessageText = getMessageText(sendRequestStub.firstCall.args[0][1]);
        expect(userMessageText).to.include("<nearby_sql_diagnostics>");
        expect(userMessageText).to.include("query.sql:1:8 error SQL102");
        expect(userMessageText).to.include("Incorrect syntax near 'GROUP BY'");
        expect(userMessageText).to.not.include("C:\\Users");
    });

    test("skips exact token counting when a non-debug prompt is well under the model window", async () => {
        schemaContextService.getSchemaContext.resolves(undefined);
        (vscode.lm.selectChatModels as sinon.SinonStub).resolves([
            {
                sendRequest: sendRequestStub,
                countTokens: countTokensStub,
                maxInputTokens: 100000,
            } as unknown as vscode.LanguageModelChat,
        ]);

        const items = await provider.provideInlineCompletionItems(
            createTestDocument("SELECT *", "file:///query.sql"),
            new vscode.Position(0, "SELECT *".length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect(items).to.have.lengthOf(1);
        expect(countTokensStub).to.not.have.been.called;
    });

    test("returns no completions when no Copilot language model is available", async () => {
        schemaContextService.getSchemaContext.resolves(undefined);
        (vscode.lm.selectChatModels as sinon.SinonStub).resolves([]);

        const items = await provider.provideInlineCompletionItems(
            createTestDocument("SELECT", "file:///query.sql"),
            new vscode.Position(0, "SELECT".length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect(items).to.deep.equal([]);
        expect(sendRequestStub).to.not.have.been.called;
    });

    test("returns no completions when the feature flag is disabled", async () => {
        inlineCompletionFeatureEnabled = false;

        const items = await provider.provideInlineCompletionItems(
            createTestDocument("SELECT", "file:///query.sql"),
            new vscode.Position(0, "SELECT".length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect(items).to.deep.equal([]);
        expect(sendRequestStub).to.not.have.been.called;
    });

    test("returns no completions when experimental features are disabled", async () => {
        experimentalFeaturesEnabled = false;

        const items = await provider.provideInlineCompletionItems(
            createTestDocument("SELECT", "file:///query.sql"),
            new vscode.Position(0, "SELECT".length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect(items).to.deep.equal([]);
        expect(sendRequestStub).to.not.have.been.called;
    });

    test("returns no completions when the continuation category is disabled", async () => {
        enabledCategories = ["intent"];
        inlineCompletionDebugStore.updateOverrides({ profileId: "custom" });

        const items = await provider.provideInlineCompletionItems(
            createTestDocument("SELECT *", "file:///query.sql"),
            new vscode.Position(0, "SELECT *".length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect(items).to.deep.equal([]);
        expect(sendRequestStub).to.not.have.been.called;
    });

    test("returns no completions when the intent category is disabled", async () => {
        enabledCategories = ["continuation"];
        inlineCompletionDebugStore.updateOverrides({ profileId: "custom" });

        const line = "-- Write a query to show all customers";
        const items = await provider.provideInlineCompletionItems(
            createTestDocument(line, "file:///query.sql"),
            new vscode.Position(0, line.length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect(items).to.deep.equal([]);
        expect(sendRequestStub).to.not.have.been.called;
    });

    test("uses the runtime category override before requesting a model", async () => {
        inlineCompletionDebugStore.updateOverrides({ enabledCategories: ["intent"] });

        const items = await provider.provideInlineCompletionItems(
            createTestDocument("SELECT *", "file:///query.sql"),
            new vscode.Position(0, "SELECT *".length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect(items).to.deep.equal([]);
        expect(sendRequestStub).to.not.have.been.called;
    });

    test("uses the active debug profile categories before requesting a model", async () => {
        inlineCompletionDebugStore.updateOverrides({ profileId: "focused" });

        const items = await provider.provideInlineCompletionItems(
            createTestDocument("SELECT *", "file:///query.sql"),
            new vscode.Position(0, "SELECT *".length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect(items).to.deep.equal([]);
        expect(sendRequestStub).to.not.have.been.called;
    });

    test("uses the configured default profile categories before requesting a model", async () => {
        configuredProfile = "focused";

        const items = await provider.provideInlineCompletionItems(
            createTestDocument("SELECT *", "file:///query.sql"),
            new vscode.Position(0, "SELECT *".length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect(items).to.deep.equal([]);
        expect(sendRequestStub).to.not.have.been.called;
    });

    test("uses balanced as the fallback profile when no profile setting is available", async () => {
        configuredProfile = undefined;
        schemaContextService.getSchemaContext.resolves(undefined);

        const items = await provider.provideInlineCompletionItems(
            createTestDocument("SELECT *", "file:///query.sql"),
            new vscode.Position(0, "SELECT *".length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect(items).to.have.lengthOf(1);
        expect(sendRequestStub).to.have.been.calledOnce;
    });

    test("uses balanced profile big intent and small continuation model preferences", async () => {
        const sonnetSendRequest = sandbox.stub().resolves(createChatResponse("SELECT 1;"));
        const haikuSendRequest = sandbox.stub().resolves(createChatResponse("FROM dbo.Customers"));
        const gptSendRequest = sandbox.stub().resolves(createChatResponse("SELECT 2;"));
        (vscode.lm.selectChatModels as sinon.SinonStub).callsFake(async ({ vendor }) => {
            if (vendor === "copilot") {
                return [
                    {
                        id: "copilot-sonnet",
                        name: "Claude Sonnet 4.6",
                        family: "claude-sonnet",
                        vendor: "copilot",
                        sendRequest: sonnetSendRequest,
                        countTokens: countTokensStub,
                    },
                    {
                        id: "copilot-haiku",
                        name: "Claude Haiku 4.5",
                        family: "claude-haiku",
                        vendor: "copilot",
                        sendRequest: haikuSendRequest,
                        countTokens: countTokensStub,
                    },
                ];
            }

            if (vendor === "openai-api") {
                return [
                    {
                        id: "gpt-5.5",
                        name: "GPT-5.5",
                        family: "gpt-5.5",
                        vendor: "openai-api",
                        sendRequest: gptSendRequest,
                        countTokens: countTokensStub,
                    },
                ];
            }

            return [];
        });
        schemaContextService.getSchemaContext.resolves(undefined);

        await provider.provideInlineCompletionItems(
            createTestDocument("SELECT *", "file:///query.sql"),
            new vscode.Position(0, "SELECT *".length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        await provider.provideInlineCompletionItems(
            createTestDocument("-- Write a query to show one row\n", "file:///query.sql"),
            new vscode.Position(1, 0),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect(haikuSendRequest).to.have.been.calledOnce;
        expect(sonnetSendRequest).to.have.been.calledOnce;
        expect(gptSendRequest).to.not.have.been.called;
    });

    test("uses runtime category overrides over the configured default profile", async () => {
        configuredProfile = "focused";
        inlineCompletionDebugStore.updateOverrides({ enabledCategories: ["continuation"] });
        schemaContextService.getSchemaContext.resolves(undefined);

        const items = await provider.provideInlineCompletionItems(
            createTestDocument("SELECT *", "file:///query.sql"),
            new vscode.Position(0, "SELECT *".length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect(items).to.have.lengthOf(1);
        expect(sendRequestStub).to.have.been.calledOnce;
    });

    test("uses the continuation model override only for continuation requests", async () => {
        const defaultSendRequest = sandbox.stub().resolves(createChatResponse("SELECT 1;"));
        const continuationSendRequest = sandbox
            .stub()
            .resolves(createChatResponse("FROM dbo.Customers"));
        (vscode.lm.selectChatModels as sinon.SinonStub).callsFake(async ({ vendor }) =>
            vendor === "openai-api"
                ? [
                      {
                          id: "gpt-5.5",
                          name: "GPT-5.5",
                          family: "gpt-5.5",
                          vendor: "openai-api",
                          sendRequest: defaultSendRequest,
                          countTokens: countTokensStub,
                      },
                      {
                          id: "gpt-5.4-mini",
                          name: "GPT-5.4 Mini",
                          family: "gpt-5.4-mini",
                          vendor: "openai-api",
                          sendRequest: continuationSendRequest,
                          countTokens: countTokensStub,
                      },
                  ]
                : [],
        );
        inlineCompletionDebugStore.updateOverrides({
            modelSelector: "openai-api/gpt-5.5",
            continuationModelSelector: "openai-api/gpt-5.4-mini",
        });
        schemaContextService.getSchemaContext.resolves(undefined);

        await provider.provideInlineCompletionItems(
            createTestDocument("SELECT *", "file:///query.sql"),
            new vscode.Position(0, "SELECT *".length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        await provider.provideInlineCompletionItems(
            createTestDocument("-- Write a query to show one row\n", "file:///query.sql"),
            new vscode.Position(1, 0),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect(continuationSendRequest).to.have.been.calledOnce;
        expect(defaultSendRequest).to.have.been.calledOnce;
    });

    test("returns no completions when the cancellation token fires during the debounce wait", async () => {
        schemaContextService.getSchemaContext.resolves(undefined);

        // Already-cancelled token: the debounce delay runs, then the check fires and bails.
        const cancelledToken: vscode.CancellationToken = {
            isCancellationRequested: true,
            onCancellationRequested: sandbox.stub(),
        };

        const items = await provider.provideInlineCompletionItems(
            createTestDocument("SELECT", "file:///query.sql"),
            new vscode.Position(0, "SELECT".length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Automatic,
            } as vscode.InlineCompletionContext,
            cancelledToken,
        );

        expect(items).to.deep.equal([]);
        expect(sendRequestStub).to.not.have.been.called;
    });

    test("sanitizes markdown fences from model output", async () => {
        schemaContextService.getSchemaContext.resolves(undefined);
        sendRequestStub.resolves(createChatResponse("```sql\nORDER BY Name\n```"));

        const items = await provider.provideInlineCompletionItems(
            createTestDocument("SELECT * FROM dbo.Customers", "file:///query.sql"),
            new vscode.Position(0, "SELECT * FROM dbo.Customers".length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect(items).to.have.lengthOf(1);
        // ORDER BY is a clause keyword — fixLeadingWhitespace adds a newline.
        expect((items as vscode.InlineCompletionItem[])[0].insertText).to.equal("\nORDER BY Name");
    });

    test("detects intent mode for a comment followed by a blank line", () => {
        expect(detectIntentComment("-- Write a query to give all orders per region", "")).to.equal(
            true,
        );
    });

    test("detects intent mode when the user has started typing SELECT", () => {
        expect(
            detectIntentComment(
                "-- Write a query to give all orders per region\nSELECT",
                "SELECT ",
            ),
        ).to.equal(true);
    });

    test("does not trigger intent mode for a mid-statement comment", () => {
        expect(
            detectIntentComment("SELECT * FROM Orders -- active only\nWHERE", "WHERE "),
        ).to.equal(false);
    });

    test("detects intent mode for a closed block comment followed by a blank line", () => {
        expect(detectIntentComment("/* Get sum of sales by month */", "")).to.equal(true);
    });

    test("does not trigger intent mode for an unterminated block comment", () => {
        expect(detectIntentComment("/* Get sum of sales by month", "")).to.equal(false);
    });

    test("detects intent mode across multiple trailing comment lines", () => {
        expect(
            detectIntentComment("-- Notes\n-- Give me all the orders", "-- Give me all the orders"),
        ).to.equal(true);
    });

    test("does not trigger intent mode when the comment lacks an instructional verb or query noun", () => {
        expect(detectIntentComment("-- orders table", "")).to.equal(false);
    });

    test("detects intent mode for question-style comment prompts", () => {
        expect(detectIntentComment("-- What are all the active sessions", "")).to.equal(true);
    });

    test("detects intent mode for leading auxiliary question comments", () => {
        expect(detectIntentComment("-- are there any unused indexes in the database", "")).to.equal(
            true,
        );
        expect(detectIntentComment("-- do any orders have no customer", "")).to.equal(true);
    });

    test("does not trigger intent mode for auxiliary words later in documentation comments", () => {
        expect(detectIntentComment("-- indexes are expensive to maintain", "")).to.equal(false);
        expect(detectIntentComment("-- orders have customer references", "")).to.equal(false);
    });

    test("detects intent mode for trailing question comments without an instruction verb", () => {
        expect(detectIntentComment("-- the top sales people in US?", "")).to.equal(true);
    });

    test("builds prompt rules that prefer empty output for unnatural completions and stable intent formatting", () => {
        const intentRules = buildCompletionRules(false, true);
        const continuationRules = buildCompletionRules(false, false);

        expect(intentRules).to.include(
            "The document suffix and current line suffix are authoritative context",
        );
        expect(intentRules).to.include(
            "TABLE NAMES / VIEW NAMES / ROUTINE NAMES inventory entries",
        );
        expect(intentRules).to.include(
            "broad discovery queries, EXEC name exploration, or simple SELECT * exploration",
        );
        expect(intentRules).to.include("Prefer stable conventional formatting");
        expect(intentRules).to.include("canonical multiline layout");
        expect(intentRules).to.include("Prefer uppercase SQL keywords");
        expect(continuationRules).to.include(
            "If no natural single-unit continuation fits the current line suffix and document suffix",
        );
        expect(continuationRules).to.include(
            "Do not provide an explanation, diagnosis, apology, note, or reason",
        );
    });

    test("does not trigger intent mode when the post-comment text is not statement-initiating", () => {
        expect(detectIntentComment("-- Write a query to list orders\nWHERE", "WHERE ")).to.equal(
            false,
        );
    });

    test("detects intent mode for a block comment with trailing whitespace only", () => {
        expect(detectIntentComment("/* Generate a sales report by month */", "   ")).to.equal(true);
    });

    test("starts intent-mode completion on a new line when the cursor is still on a line comment", async () => {
        schemaContextService.getSchemaContext.resolves(undefined);
        sendRequestStub.resolves(createChatResponse("SELECT TOP 10 * FROM dbo.Orders;"));

        const line = "-- Write a query to show the most regressed queries";
        const items = await provider.provideInlineCompletionItems(
            createTestDocument(line, "file:///query.sql"),
            new vscode.Position(0, line.length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect(items).to.have.lengthOf(1);
        expect((items as vscode.InlineCompletionItem[])[0].insertText).to.equal(
            "\nSELECT TOP 10 * FROM dbo.Orders;",
        );
    });

    test("starts intent-mode completion on a new line for question-style comment prompts", async () => {
        schemaContextService.getSchemaContext.resolves(undefined);
        sendRequestStub.resolves(
            createChatResponse("SELECT * FROM sys.dm_exec_sessions WHERE is_user_process = 1;"),
        );

        const line = "-- what are all the active sessions";
        const items = await provider.provideInlineCompletionItems(
            createTestDocument(line, "file:///query.sql"),
            new vscode.Position(0, line.length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect(items).to.have.lengthOf(1);
        expect((items as vscode.InlineCompletionItem[])[0].insertText).to.equal(
            "\nSELECT * FROM sys.dm_exec_sessions WHERE is_user_process = 1;",
        );
    });

    test("suppresses intent-mode completion when the cursor is in the middle of a line comment", async () => {
        schemaContextService.getSchemaContext.resolves(undefined);

        const line = "-- show all the customers";
        const items = await provider.provideInlineCompletionItems(
            createTestDocument(line, "file:///query.sql"),
            new vscode.Position(0, "-- show all".length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect(items).to.deep.equal([]);
        expect(sendRequestStub).to.not.have.been.called;
    });

    test("starts intent-mode completion on a new line and preserves indentation for a closed block comment", async () => {
        schemaContextService.getSchemaContext.resolves(undefined);
        sendRequestStub.resolves(createChatResponse("SELECT TOP 10 * FROM dbo.Orders;"));

        const line = "    /* Write a query to list all orders */";
        const items = await provider.provideInlineCompletionItems(
            createTestDocument(line, "file:///query.sql"),
            new vscode.Position(0, line.length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect(items).to.have.lengthOf(1);
        expect((items as vscode.InlineCompletionItem[])[0].insertText).to.equal(
            "\n    SELECT TOP 10 * FROM dbo.Orders;",
        );
    });

    test("suppresses intent-mode completion when the generated query already exists in the document suffix", async () => {
        schemaContextService.getSchemaContext.resolves(undefined);
        const query = `SELECT
  s.session_id,
  s.login_name,
  s.host_name,
  s.program_name,
  s.login_time,
  s.last_request_end_time,
  r.status,
  r.command,
  r.wait_type,
  r.cpu_time,
  r.total_elapsed_time,
  t.text
FROM sys.dm_exec_sessions s
LEFT JOIN sys.dm_exec_requests r ON s.session_id = r.session_id
LEFT JOIN sys.dm_exec_sql_text(r.sql_handle) t ON r.sql_handle = t.sql_handle
WHERE s.session_id > 50
ORDER BY s.login_time DESC;`;
        sendRequestStub.resolves(createChatResponse(query));

        const commentLine =
            "-- Write a query to find all currently active user sessions with their details";
        const items = await provider.provideInlineCompletionItems(
            createTestDocument(`${commentLine}\n${query}`, "file:///query.sql"),
            new vscode.Position(0, commentLine.length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect(items).to.deep.equal([]);
    });

    test("uses intent-mode prompt rules and keeps the separator when the model echoes SELECT", async () => {
        schemaContextService.getSchemaContext.resolves({
            server: "localhost",
            database: "Sales",
            defaultSchema: "dbo",
            schemas: ["dbo"],
            tables: [{ name: "dbo.Orders", columns: ["OrderId", "OrderDate", "CustomerId"] }],
            views: [],
            masterSymbols: [],
        });
        sendRequestStub.resolves(createChatResponse("SELECT * FROM dbo.Orders;"));

        const items = await provider.provideInlineCompletionItems(
            createTestDocument("-- Write a query to list all orders\nSELECT", "file:///query.sql"),
            new vscode.Position(1, "SELECT".length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect(items).to.have.lengthOf(1);
        expect((items as vscode.InlineCompletionItem[])[0].insertText).to.equal(
            " * FROM dbo.Orders;",
        );

        const requestOptions = sendRequestStub.firstCall.args[1];
        expect(requestOptions.modelOptions.maxTokens).to.equal(intentModeMaxTokens);

        const instructionText = getMessageText(sendRequestStub.firstCall.args[0][0]);
        const userMessageText = getMessageText(sendRequestStub.firstCall.args[0][1]);
        expect(instructionText).to.include("Return the complete SQL statement");
        expect(userMessageText).to.include("<mode>intent (return complete query)</mode>");
    });

    test("keeps valid intent-mode cached-plan DMV SQL", async () => {
        schemaContextService.getSchemaContext.resolves(undefined);
        const cachedPlanQuery = `SELECT
    qs.plan_handle,
    qs.creation_time,
    qs.last_execution_time,
    qs.execution_count,
    qs.total_worker_time,
    qs.total_elapsed_time,
    qs.total_logical_reads,
    qs.total_logical_writes,
    st.text AS sql_text,
    qp.query_plan
FROM sys.dm_exec_query_stats AS qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) AS st
CROSS APPLY sys.dm_exec_query_plan(qs.plan_handle) AS qp
WHERE st.dbid = DB_ID()
ORDER BY qs.total_worker_time DESC;`;
        sendRequestStub.resolves(createChatResponse(cachedPlanQuery));

        const items = await provider.provideInlineCompletionItems(
            createTestDocument("-- what are the cached plans in the db\n", "file:///query.sql"),
            new vscode.Position(1, 0),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect(items).to.have.lengthOf(1);
        expect((items as vscode.InlineCompletionItem[])[0].insertText).to.equal(cachedPlanQuery);
    });

    test("does not truncate continuation stops inside string literals", () => {
        const sanitized = sanitizeInlineCompletionText(
            "WHERE NoteText = 'line one\n\nline two'\n\nORDER BY CreatedAt",
            200,
            "SELECT * FROM dbo.Notes ",
            false,
        );

        expect(sanitized).to.equal("WHERE NoteText = 'line one\n\nline two'");
    });

    test("drops continuation-mode prose explanations from small models", () => {
        const sanitized = sanitizeInlineCompletionText(
            "The current statement is malformed-it contains `GROUP BY` followed by a `SELECT` with no natural single-unit continuation.",
            400,
            "inner join sys.dm_os_sys_info",
            false,
        );

        expect(sanitized).to.equal(undefined);
    });

    test("drops parenthesized empty-string sentinel replies", () => {
        for (const response of [
            "(empty string)",
            "`empty string`",
            "<empty>",
            "(empty response)",
            "No response",
            "No SQL",
        ]) {
            const sanitized = sanitizeInlineCompletionText(response, 400, "", false);
            expect(sanitized, response).to.equal(undefined);
        }
    });

    test("drops leaked reasoning tags and leading no-schema prose", () => {
        expect(sanitizeInlineCompletionText("</think>", 400, "", true)).to.equal(undefined);
        expect(
            sanitizeInlineCompletionText("<think>checking schema</think>\nSELECT 1", 400, "", true),
        ).to.equal("SELECT 1");
        expect(
            sanitizeInlineCompletionText(
                'No InvoiceLines columns are available, and "area" cannot be resolved against detailed schema columns.',
                400,
                "",
                true,
            ),
        ).to.equal(undefined);
    });

    test("drops standalone XML-like model control responses", () => {
        for (const response of ["</s>", "<sql>SELECT 1</sql>", '<?xml version="1.0"?><x />']) {
            expect(sanitizeInlineCompletionText(response, 400, "", true), response).to.equal(
                undefined,
            );
        }

        expect(
            sanitizeInlineCompletionText("SELECT 1 FOR XML PATH('row')", 400, "", true),
        ).to.equal("SELECT 1 FOR XML PATH('row')");
        expect(sanitizeInlineCompletionText("SELECT '<row />' AS Payload", 400, "", true)).to.equal(
            "SELECT '<row />' AS Payload",
        );
    });

    test("starts longer generated SELECT statements on a new line", async () => {
        schemaContextService.getSchemaContext.resolves(undefined);
        sendRequestStub.resolves(createChatResponse("SELECT TOP 10 * FROM dbo.Customers"));

        const items = await provider.provideInlineCompletionItems(
            createTestDocument("GROUP BY ", "file:///query.sql"),
            new vscode.Position(0, "GROUP BY ".length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect((items as vscode.InlineCompletionItem[])[0].insertText).to.equal(
            "\nSELECT TOP 10 * FROM dbo.Customers",
        );
    });

    test("keeps very short SELECT completions on the current line", async () => {
        schemaContextService.getSchemaContext.resolves(undefined);
        sendRequestStub.resolves(createChatResponse("SELECT 1"));

        const items = await provider.provideInlineCompletionItems(
            createTestDocument("IF EXISTS ", "file:///query.sql"),
            new vscode.Position(0, "IF EXISTS ".length),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect((items as vscode.InlineCompletionItem[])[0].insertText).to.equal("SELECT 1");
    });

    test("returns no completion when intent mode produces an explanation instead of SQL", async () => {
        schemaContextService.getSchemaContext.resolves({
            server: "localhost",
            database: "WideWorldImportersDb",
            defaultSchema: "dbo",
            schemas: ["dbo", "Sales"],
            tables: [{ name: "Sales.Customers", columns: ["CustomerID", "CustomerName"] }],
            views: [],
            masterSymbols: [],
        });
        sendRequestStub.resolves(
            createChatResponse(
                "I don't see Sales order/invoice tables clearly in the schema context provided.\n\nReturning empty string as the schema context lacks sufficient Sales transaction table definitions.",
            ),
        );

        const items = await provider.provideInlineCompletionItems(
            createTestDocument(
                "-- Generate a query that gets the top 10 people that bought products in Jan\n",
                "file:///query.sql",
            ),
            new vscode.Position(1, 0),
            {
                triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
            } as vscode.InlineCompletionContext,
            { isCancellationRequested: false } as vscode.CancellationToken,
        );

        expect(items).to.deep.equal([]);

        const instructionText = getMessageText(sendRequestStub.firstCall.args[0][0]);
        expect(instructionText).to.include("return exactly an empty string");
        expect(instructionText).to.include("Do not explain why");
    });
});

function createChatResponse(text: string): vscode.LanguageModelChatResponse {
    return {
        stream: (async function* () {
            yield new vscode.LanguageModelTextPart(text);
        })(),
    } as unknown as vscode.LanguageModelChatResponse;
}

function getMessageText(message: vscode.LanguageModelChatMessage): string {
    return message.content
        .map((part) => (part instanceof vscode.LanguageModelTextPart ? part.value : ""))
        .join("");
}
