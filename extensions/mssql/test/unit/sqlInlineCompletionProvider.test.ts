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
    let configuredModelFamily: string;

    setup(() => {
        sandbox = sinon.createSandbox();
        stubTelemetry(sandbox);
        experimentalFeaturesEnabled = true;
        inlineCompletionFeatureEnabled = true;
        configuredModelFamily = "";

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

                    if (key === Constants.configCopilotInlineCompletionsModelFamily) {
                        return configuredModelFamily;
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
            modelFamily: null,
            useSchemaContext: null,
            debounceMs: null,
            maxTokens: null,
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
        expect(getMessageText(messages[1])).to.include("Current statement prefix:");
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
        expect(userMessageText).to.include("Schema context:\n-- unavailable");
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
            "Recent document prefix:\nDECLARE @start_time datetime = DATEADD(DAY, -1, GETDATE());",
        );
        expect(userMessageText).to.include(
            "Current line prefix:\nDECLARE @end_time datetime = GETDATE(); ",
        );
        expect(userMessageText).to.include("Document suffix:");
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

    test("builds prompt rules that prefer empty output for unnatural completions and stable intent formatting", () => {
        const intentRules = buildCompletionRules(false, true);
        const continuationRules = buildCompletionRules(false, false);

        expect(intentRules).to.include(
            "The document suffix and current line suffix are authoritative context",
        );
        expect(intentRules).to.include("TABLE NAMES / VIEW NAMES inventory entries");
        expect(intentRules).to.include("broad discovery queries or simple SELECT * exploration");
        expect(intentRules).to.include("Prefer stable conventional formatting");
        expect(intentRules).to.include("canonical multiline layout");
        expect(intentRules).to.include("Prefer uppercase SQL keywords");
        expect(continuationRules).to.include(
            "If no natural single-unit continuation fits the current line suffix and document suffix",
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
        expect(userMessageText).to.include("Mode: intent (return complete query)");
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
