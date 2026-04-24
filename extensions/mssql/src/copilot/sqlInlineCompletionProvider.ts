/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import { logger2 } from "../models/logger2";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";
import { getErrorMessage } from "../utils/utils";
import { inlineCompletionDebugStore } from "./inlineCompletionDebug/inlineCompletionDebugStore";
import { isInlineCompletionFeatureEnabled } from "./inlineCompletionFeatureGate";
import {
    SqlInlineCompletionSchemaContext,
    SqlInlineCompletionSchemaContextService,
    SqlInlineCompletionSchemaObject,
} from "./sqlInlineCompletionSchemaContextService";
import {
    InlineCompletionDebugEvent,
    InlineCompletionDebugEventResult,
    InlineCompletionDebugPromptMessage,
    InlineCompletionResult,
} from "../sharedInterfaces/inlineCompletionDebug";

// MSSQL owns SQL ghost text for this feature. VS Code does not expose a hook to augment
// GitHub Copilot's built-in inline-completion request, so this provider uses Copilot chat
// models directly and assumes github.copilot.enable["sql"] = false to avoid provider races.
// If the user configured mssql.copilot.inlineCompletions.modelFamily we respect it; otherwise
// we choose the strongest available Copilot model regardless of trigger, because SQL completion
// quality has been more valuable in practice than shaving a bit of latency.
const modelFamilyFallbackPreferences: RegExp[] = [
    /^claude-sonnet/i,
    /^claude-opus/i,
    /^gpt-5.*codex/i,
    /^gpt-5(?!.*(mini|codex))/i,
    /^gpt-5.*mini/i,
    /^gpt-4o(?!-mini)/i,
    /^gpt-4o-mini/i,
    /^claude.*haiku/i,
];

const statementPrefixWindowChars = 2500;
const recentPrefixWindowChars = 1500;
const suffixWindowChars = 500;
const maxCompletionChars = 400;
export const continuationModeMaxTokens = 240;
export const intentModeMaxChars = 2000;
export const intentModeMaxTokens = 800;
export const automaticTriggerDebounceMs = 350;
const inlineCompletionAcceptedCommand = "mssql.copilot.inlineCompletion.accepted";
const statementInitiatingKeywordPattern =
    /^(?:select|with|insert|update|delete|merge|exec|execute|declare)$/i;
const statementInitiatingPostCommentPattern =
    /^\s*(?:select|with|insert|update|delete|merge|exec|execute|declare)\s*$/i;
const instructionalIntentWordPattern =
    /\b(?:write|give|get|show|list|find|return|display|compute|count|sum|report|select|fetch|query|retrieve|calculate|generate|estimate)\b/i;
const questionStyleIntentPattern = /(?:^|\n)\s*(?:what|which|who|where|when|why|how)\b/i;
const metaResponseInsteadOfSqlPattern =
    /^(?:i\b|i[' ]|sorry\b|cannot\b|can't\b|unable\b|however\b|there(?:'s| is)\b|the (?:document|query|statement|schema)\b|(?:this|that) (?:document|query|statement)\b|schema context\b|returning\b|not enough\b|insufficient\b|already (?:complete|done)\b|complete\b|done\b|no (?:further )?(?:completion|change|changes)\b)/i;
const emptyStringInstructionEchoPattern =
    /\b(?:return|returns|returning|emit|emits|output|outputs)\s+(?:exactly\s+)?(?:an?\s+)?(?:empty|string empty|empty string)\b/i;

interface InlineCompletionTelemetrySnapshot {
    usedSchemaContext: boolean;
    fallbackWithoutMetadata: boolean;
    schemaObjectCount: number;
    schemaSystemObjectCount: number;
    schemaForeignKeyCount: number;
    modelFamily: string;
    triggerKind: string;
    latencyMs: number;
    inferredSystemQuery: boolean;
    intentMode: boolean;
}

export class SqlInlineCompletionProvider
    implements vscode.InlineCompletionItemProvider, vscode.Disposable
{
    private readonly _logger = logger2.withPrefix("SqlInlineCompletion");
    private readonly _disposables: vscode.Disposable[] = [];
    private _cachedModel: vscode.LanguageModelChat | undefined;
    private _cachedModelInitialized: boolean = false;
    private _cachedModelSelectorKey: string | undefined;

    constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _schemaContextService: SqlInlineCompletionSchemaContextService,
    ) {
        this._disposables.push(
            vscode.lm.onDidChangeChatModels(() => {
                this.clearModelCache();
            }),
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration(Constants.configCopilotInlineCompletionsModelFamily)) {
                    this.clearModelCache();
                }
            }),
            vscode.commands.registerCommand(
                inlineCompletionAcceptedCommand,
                (snapshot?: InlineCompletionTelemetrySnapshot, eventId?: string) => {
                    if (eventId) {
                        inlineCompletionDebugStore.markAccepted(eventId);
                    }
                    this.sendInlineCompletionTelemetry("accepted", snapshot);
                },
            ),
        );
    }

    public dispose(): void {
        this._disposables.forEach((d) => d.dispose());
        this.clearModelCache();
    }

    public async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken,
    ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList> {
        if (!this.isEnabledForDocument(document) || context.selectedCompletionInfo) {
            return [];
        }

        const triggerKind = context.triggerKind;
        const overrides = inlineCompletionDebugStore.getOverrides();
        const line = document.lineAt(position.line);
        const linePrefix = line.text.slice(0, position.character);
        const lineSuffix = line.text.slice(position.character);
        const statementPrefix = getStatementAwarePrefixWindow(
            document,
            position,
            statementPrefixWindowChars,
        );
        const recentPrefix = getRecentDocumentPrefixWindow(
            document,
            position,
            recentPrefixWindowChars,
        );
        const suffix = getSuffixWindow(document, position, suffixWindowChars);
        const inferredSystemQuery = inferSystemQuery(statementPrefix, linePrefix);
        const detectedIntentMode = detectIntentMode(statementPrefix, linePrefix);
        const intentMode = overrides.forceIntentMode ?? detectedIntentMode;
        const effectiveMaxTokens =
            overrides.maxTokens ?? (intentMode ? intentModeMaxTokens : continuationModeMaxTokens);
        const effectiveMaxChars = getEffectiveMaxCompletionChars(
            intentMode ? intentModeMaxChars : maxCompletionChars,
            overrides.maxTokens,
        );
        const debounceMsApplied =
            triggerKind === vscode.InlineCompletionTriggerKind.Automatic
                ? (overrides.debounceMs ?? automaticTriggerDebounceMs)
                : 0;
        const useSchemaContext = overrides.useSchemaContext ?? this.getConfiguredUseSchemaContext();
        const shouldCaptureDebug = inlineCompletionDebugStore.shouldCapture(
            this.getRecordWhenClosedSetting(),
        );

        if (
            triggerKind === vscode.InlineCompletionTriggerKind.Automatic &&
            overrides.allowAutomaticTriggers === false
        ) {
            return [];
        }

        if (intentMode && shouldSuppressIntentCompletionOnCommentLine(linePrefix, lineSuffix)) {
            return [];
        }

        let selectedModel: vscode.LanguageModelChat | undefined;
        let schemaContext: SqlInlineCompletionSchemaContext | undefined;
        let schemaContextForPrompt: SqlInlineCompletionSchemaContext | undefined;
        let promptMessages: vscode.LanguageModelChatMessage[] = [];
        let debugPromptMessages: InlineCompletionDebugPromptMessage[] = [];
        let schemaContextText: string | undefined;
        let rawText = "";
        let sanitizedText: string | undefined;
        let finalCompletionText: string | undefined;
        let inputTokens: number | undefined;
        let outputTokens: number | undefined;
        let modelCallStarted = false;

        if (triggerKind === vscode.InlineCompletionTriggerKind.Automatic) {
            await delay(debounceMsApplied, token);
            if (token.isCancellationRequested) {
                return [];
            }
        }

        const modelStartedAt = Date.now();
        const recordDebugEvent = (
            result: InlineCompletionDebugEventResult,
            error?: unknown,
        ): InlineCompletionDebugEvent | undefined => {
            if (!shouldCaptureDebug) {
                return undefined;
            }

            return inlineCompletionDebugStore.addEvent({
                timestamp: Date.now(),
                documentUri: document.uri.toString(),
                documentFileName: path.basename(document.fileName || document.uri.fsPath),
                line: position.line + 1,
                column: position.character + 1,
                triggerKind: getTriggerKindName(triggerKind),
                explicitFromUser: triggerKind === vscode.InlineCompletionTriggerKind.Invoke,
                intentMode,
                inferredSystemQuery,
                modelFamily: selectedModel?.family,
                modelId: selectedModel?.id,
                modelVendor: selectedModel?.vendor,
                result,
                latencyMs: Date.now() - modelStartedAt,
                inputTokens,
                outputTokens,
                schemaObjectCount:
                    (schemaContext?.tables.length ?? 0) + (schemaContext?.views.length ?? 0),
                schemaSystemObjectCount:
                    (schemaContext?.systemObjects?.length ?? 0) +
                    (schemaContext?.masterSymbols.length ?? 0),
                schemaForeignKeyCount: getForeignKeyCount(schemaContext),
                usedSchemaContext: !!schemaContext,
                overridesApplied: {
                    ...(overrides.modelFamily ? { modelFamily: overrides.modelFamily } : {}),
                    ...(overrides.useSchemaContext !== null
                        ? { useSchemaContext: overrides.useSchemaContext }
                        : {}),
                    ...(overrides.debounceMs !== null ? { debounceMs: overrides.debounceMs } : {}),
                    ...(overrides.maxTokens !== null ? { maxTokens: overrides.maxTokens } : {}),
                    customSystemPromptUsed: !!overrides.customSystemPrompt,
                },
                promptMessages: debugPromptMessages,
                rawResponse: rawText,
                sanitizedResponse: sanitizedText,
                finalCompletionText,
                schemaContextFormatted: schemaContextText,
                locals: {
                    "context.selectedCompletionInfo": context.selectedCompletionInfo
                        ? "defined"
                        : "undefined",
                    "context.triggerKind": context.triggerKind,
                    "document.languageId": document.languageId,
                    "position.line": position.line,
                    "position.character": position.character,
                    linePrefix,
                    "recentPrefix.length": recentPrefix.length,
                    recentPrefix,
                    "statementPrefix.length": statementPrefix.length,
                    statementPrefix,
                    lineSuffix,
                    "suffix.length": suffix.length,
                    suffix,
                    intentMode,
                    detectedIntentMode,
                    inferredSystemQuery,
                    useSchemaContext,
                    effectiveMaxTokens,
                    effectiveMaxChars,
                    debounceMsApplied,
                    selectedModelMaxInputTokens: selectedModel?.maxInputTokens,
                    selectedModelName: selectedModel?.name,
                    selectedModelVersion: selectedModel?.version,
                    customSystemPromptActive: !!overrides.customSystemPrompt,
                },
                error: error
                    ? {
                          message: getErrorMessage(error),
                          ...(error instanceof Error && error.name ? { name: error.name } : {}),
                          ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
                      }
                    : undefined,
            });
        };

        try {
            selectedModel = await this.getCopilotModel(overrides.modelFamily ?? undefined);
            if (!selectedModel) {
                const telemetrySnapshot = createInlineTelemetrySnapshot(
                    undefined,
                    undefined,
                    modelStartedAt,
                    triggerKind,
                    inferredSystemQuery,
                    intentMode,
                );
                this.sendInlineCompletionTelemetry("noModel", telemetrySnapshot);
                recordDebugEvent("noModel");
                return [];
            }

            const canSendRequest: boolean | undefined =
                this._context.languageModelAccessInformation?.canSendRequest(selectedModel);
            if (
                canSendRequest === false ||
                (canSendRequest === undefined &&
                    triggerKind === vscode.InlineCompletionTriggerKind.Automatic)
            ) {
                const telemetrySnapshot = createInlineTelemetrySnapshot(
                    undefined,
                    selectedModel.family,
                    modelStartedAt,
                    triggerKind,
                    inferredSystemQuery,
                    intentMode,
                );
                this.sendInlineCompletionTelemetry("noPermission", telemetrySnapshot);
                recordDebugEvent("noPermission");
                return [];
            }

            if (useSchemaContext) {
                schemaContext = await this._schemaContextService.getSchemaContext(
                    document,
                    statementPrefix,
                );
            }

            if (token.isCancellationRequested) {
                return [];
            }

            schemaContextForPrompt = withInferredSystemQuery(schemaContext, inferredSystemQuery);
            schemaContextText = formatSchemaContextForPrompt(
                schemaContextForPrompt,
                inferredSystemQuery,
            );
            const rulesText = resolveInlineCompletionRules({
                customSystemPrompt: overrides.customSystemPrompt,
                inferredSystemQuery,
                intentMode,
                schemaContextText,
                linePrefix,
                recentPrefix,
                statementPrefix,
            });
            promptMessages = buildInlineCompletionPromptMessages({
                rulesText,
                intentMode,
                recentPrefix,
                statementPrefix,
                suffix,
                linePrefix,
                lineSuffix,
                schemaContextText,
            });
            debugPromptMessages = shouldCaptureDebug
                ? promptMessages.map(toDebugPromptMessage)
                : [];
            inputTokens = shouldCaptureDebug
                ? await countLanguageModelTokens(selectedModel, promptMessages, token)
                : undefined;

            modelCallStarted = true;
            const response = await selectedModel.sendRequest(
                promptMessages,
                {
                    justification:
                        "MSSQL inline SQL completion uses a Copilot language model to generate ghost text.",
                    modelOptions: createLanguageModelMaxTokenOptions(effectiveMaxTokens),
                },
                token,
            );

            rawText = await collectText(response, token);
            if (token.isCancellationRequested) {
                recordDebugEvent("cancelled");
                return [];
            }
            outputTokens = shouldCaptureDebug
                ? await countLanguageModelTokens(selectedModel, rawText, token)
                : undefined;

            sanitizedText = sanitizeInlineCompletionText(
                rawText,
                effectiveMaxChars,
                linePrefix,
                intentMode,
            );

            if (!sanitizedText) {
                const result = rawText.trim() ? "emptyFromSanitizer" : "emptyFromModel";
                const telemetrySnapshot = createInlineTelemetrySnapshot(
                    schemaContext,
                    selectedModel.family,
                    modelStartedAt,
                    triggerKind,
                    inferredSystemQuery,
                    intentMode,
                );
                this.sendInlineCompletionTelemetry(result, telemetrySnapshot);
                recordDebugEvent(result);
                return [];
            }

            finalCompletionText = fixLeadingWhitespace(
                sanitizedText,
                linePrefix,
                schemaContextForPrompt,
                intentMode,
            );
            finalCompletionText = suppressDocumentSuffixOverlap(finalCompletionText, suffix);

            if (!finalCompletionText) {
                const telemetrySnapshot = createInlineTelemetrySnapshot(
                    schemaContext,
                    selectedModel.family,
                    modelStartedAt,
                    triggerKind,
                    inferredSystemQuery,
                    intentMode,
                );
                this.sendInlineCompletionTelemetry("emptyFromSanitizer", telemetrySnapshot);
                recordDebugEvent("emptyFromSanitizer");
                return [];
            }

            const telemetrySnapshot = createInlineTelemetrySnapshot(
                schemaContext,
                selectedModel.family,
                modelStartedAt,
                triggerKind,
                inferredSystemQuery,
                intentMode,
            );
            this.sendInlineCompletionTelemetry("success", telemetrySnapshot);
            const storedEvent = recordDebugEvent("success");

            return [
                new vscode.InlineCompletionItem(
                    finalCompletionText,
                    new vscode.Range(position, position),
                    {
                        title: "MSSQL inline SQL completion accepted",
                        command: inlineCompletionAcceptedCommand,
                        arguments: [telemetrySnapshot, storedEvent?.id],
                    },
                ),
            ];
        } catch (error) {
            if (isCancellation(token, error)) {
                if (modelCallStarted) {
                    recordDebugEvent("cancelled", error);
                }
                return [];
            }

            const errorMessage = getErrorMessage(error);
            this._logger.warn(`Inline completion request failed: ${errorMessage}`);
            const telemetrySnapshot = createInlineTelemetrySnapshot(
                schemaContext,
                selectedModel?.family,
                modelStartedAt,
                triggerKind,
                inferredSystemQuery,
                intentMode,
            );
            this.sendInlineCompletionTelemetry("error", telemetrySnapshot);
            sendErrorEvent(
                TelemetryViews.MssqlCopilot,
                TelemetryActions.InlineCompletion,
                error instanceof Error ? error : new Error(errorMessage),
                false,
            );
            recordDebugEvent("error", error);
            return [];
        }
    }

    private isEnabledForDocument(document: vscode.TextDocument): boolean {
        if (document.languageId !== Constants.languageId) {
            return false;
        }

        return isInlineCompletionFeatureEnabled();
    }

    private getConfiguredUseSchemaContext(): boolean {
        return (
            vscode.workspace
                .getConfiguration()
                .get<boolean>(Constants.configCopilotInlineCompletionsUseSchemaContext, false) ??
            false
        );
    }

    private getConfiguredModelFamily(): string | undefined {
        return (
            vscode.workspace
                .getConfiguration()
                .get<string>(Constants.configCopilotInlineCompletionsModelFamily, "")
                ?.trim() || undefined
        );
    }

    private getRecordWhenClosedSetting(): boolean {
        return (
            vscode.workspace
                .getConfiguration()
                .get<boolean>(
                    Constants.configCopilotInlineCompletionsDebugRecordWhenClosed,
                    false,
                ) ?? false
        );
    }

    private async getCopilotModel(
        modelFamilyOverride?: string,
    ): Promise<vscode.LanguageModelChat | undefined> {
        const configuredFamily = this.getConfiguredModelFamily();
        const effectiveFamily = modelFamilyOverride ?? configuredFamily;
        const selectorKey = effectiveFamily || "__auto__";

        if (this._cachedModelInitialized && this._cachedModelSelectorKey === selectorKey) {
            return this._cachedModel;
        }

        if (this._cachedModelSelectorKey !== selectorKey) {
            this.clearModelCache();
        }

        if (effectiveFamily) {
            const exact = await vscode.lm.selectChatModels({
                vendor: "copilot",
                family: effectiveFamily,
            });
            if (exact.length > 0) {
                this._cachedModel = exact[0];
                this._cachedModelInitialized = true;
                this._cachedModelSelectorKey = selectorKey;
                return this._cachedModel;
            }
            this._logger.debug(
                `Configured model family "${effectiveFamily}" not available; selecting best available Copilot model.`,
            );
        }

        const all = await vscode.lm.selectChatModels({ vendor: "copilot" });
        this._cachedModel = selectPreferredModel(all);
        this._cachedModelInitialized = true;
        this._cachedModelSelectorKey = selectorKey;
        return this._cachedModel;
    }

    private sendInlineCompletionTelemetry(
        result: InlineCompletionResult,
        snapshot: InlineCompletionTelemetrySnapshot | undefined,
    ): void {
        sendActionEvent(TelemetryViews.MssqlCopilot, TelemetryActions.InlineCompletion, {
            result,
            usedSchemaContext: (snapshot?.usedSchemaContext ?? false).toString(),
            fallbackWithoutMetadata: (snapshot?.fallbackWithoutMetadata ?? true).toString(),
            schemaObjectCountBucket: getCountBucket(snapshot?.schemaObjectCount ?? 0),
            schemaSystemObjectCountBucket: getCountBucket(snapshot?.schemaSystemObjectCount ?? 0),
            schemaForeignKeyCountBucket: getCountBucket(snapshot?.schemaForeignKeyCount ?? 0),
            modelFamily: snapshot?.modelFamily ?? "unknown",
            triggerKind: snapshot?.triggerKind ?? "unknown",
            latencyBucket: getLatencyBucket(snapshot?.latencyMs ?? 0),
            inferredSystemQuery: (snapshot?.inferredSystemQuery ?? false).toString(),
            intentMode: (snapshot?.intentMode ?? false).toString(),
        });
    }

    private clearModelCache(): void {
        this._cachedModel = undefined;
        this._cachedModelInitialized = false;
        this._cachedModelSelectorKey = undefined;
    }
}

export function buildCompletionRules(inferredSystemQuery: boolean, intentMode: boolean): string {
    const preamble = [
        buildSharedPreamble(inferredSystemQuery),
        buildSchemaInventoryGuidance(),
    ].join("\n");
    const modeRules = intentMode ? buildIntentModeRules() : buildContinuationModeRules();
    return `${preamble}\n\n${modeRules}`;
}

function buildSharedPreamble(inferredSystemQuery: boolean): string {
    return `Shared rules:
- Use only the tables, views, columns, keys, and system objects listed in the schema context. Do not invent local database objects.
- Return no markdown, fences, backticks, quotes, labels, or explanations — raw SQL only.
- If the schema context does not contain enough information to satisfy the request, return exactly an empty string. Do not explain why, apologize, mention missing schema context, emit placeholder text such as SELECT, or say that you are returning an empty string.
- Empty string means emit no characters at all; never write prose such as "the document is complete", "done", or "return empty string".
- The document suffix and current line suffix are authoritative context. Generate text that composes naturally with both; if no natural completion fits before the suffix, return exactly an empty string.
- Use the recent document prefix to avoid repeating nearby declarations, CTE names, temp tables, aliases, or setup statements.
- Prefer the simplest canonical query that satisfies the request. Do not add extra joins, columns, filters, aliases, or system objects unless the request or schema context requires them.
- System affinity: inferredSystemQuery=${inferredSystemQuery ? "true" : "false"} — if true, prefer sys.* / INFORMATION_SCHEMA.* / DMV objects from the listed system objects; if false, prefer user tables.
- Prefer schema-qualified names.`;
}

function buildSchemaInventoryGuidance(): string {
    return `Inventory rules:
- The schema context may include detailed TABLE / VIEW entries and compact TABLE NAMES / VIEW NAMES inventory entries. Columns and keys are known only for detailed TABLE / VIEW entries.
- If an object appears only in TABLE NAMES or VIEW NAMES inventory, treat its columns as unknown. Use names-only objects only for broad discovery queries or simple SELECT * exploration.
- If the request needs specific columns, joins, predicates, aggregates, or ordering on a names-only object, return exactly an empty string.`;
}

function buildIntentModeRules(): string {
    // The "already typed SELECT or WITH" rule stays here (not in preamble or continuation)
    // because it only arises when intent mode fires on a comment + partial statement:
    //   -- Write a query to list orders
    //   SELECT [cursor]
    // Continuation mode handles cursor-continuation naturally; this rule prevents intent
    // mode from generating a fresh "SELECT ..." that would echo the keyword already typed.
    return `You generate a T-SQL query for Visual Studio Code ghost text based on a natural-language description the user wrote as a comment directly above the cursor.

Intent-mode rules:
- Return the complete SQL statement (or statements, if the intent clearly requires more than one) that satisfies the preceding comment.
- Multiple clauses, CTEs, subqueries, window functions, and aggregations are all allowed and expected.
- Do not repeat the comment text.
- Prefer stable conventional formatting over stylistic variation.
- For metadata-discovery prompts, prefer the simplest conventional catalog source that satisfies the request (for example INFORMATION_SCHEMA for basic table/column listings; sys.* only when SQL Server-specific details are needed).
- For multi-clause SELECT queries, use a canonical multiline layout: SELECT on its own line, one select item per line when there are several, and FROM, JOIN, WHERE, GROUP BY, HAVING, and ORDER BY on separate lines.
- Prefer uppercase SQL keywords.
- If the user has already typed a statement-initiating keyword such as SELECT or WITH before the cursor, continue from exactly that point — do not repeat the keyword.
- If the cursor is on a blank line after the comment, start the first SQL token directly (leading whitespace is handled by the host).
- If the cursor is still on the comment line, start the query on a new line before the first SQL token.
- End the statement with a semicolon when it is a complete standalone statement.`;
}

function buildContinuationModeRules(): string {
    return `You generate a single T-SQL inline completion for Visual Studio Code ghost text.

Continuation-mode rules:
- Return only the text to insert at the cursor.
- Return at most one logical unit: one JOIN with ON, one APPLY, one WHERE predicate, one SELECT expression, one identifier continuation, etc.
- Do not repeat text already before the cursor. Continue from the current cursor exactly.
- If no natural single-unit continuation fits the current line suffix and document suffix, return exactly an empty string. Do not invent a fresh standalone statement.
- Do not end with a semicolon. Do not emit multiple clauses chained together.
- If the cursor is after a non-whitespace character, choose the right leading space or newline. New clauses such as WHERE, JOIN, APPLY, GROUP BY, ORDER BY, OPTION, FOR JSON, and FOR XML should start on a new line.
- When completing a qualified name, preserve the dot. If the cursor is after sys and sys.databases is available, return .databases.
- JOIN context: infer join predicates from actual PK/FK metadata and compatible column names. Never write a same-side tautology such as T.Col = T.Col.`;
}

interface InlineCompletionPromptBuildOptions {
    rulesText: string;
    intentMode: boolean;
    recentPrefix: string;
    statementPrefix: string;
    suffix: string;
    linePrefix: string;
    lineSuffix: string;
    schemaContextText: string;
}

interface InlineCompletionPromptRuleOptions {
    customSystemPrompt: string | null | undefined;
    inferredSystemQuery: boolean;
    intentMode: boolean;
    schemaContextText: string;
    linePrefix: string;
    recentPrefix: string;
    statementPrefix: string;
}

export function resolveInlineCompletionRules(options: InlineCompletionPromptRuleOptions): string {
    if (!options.customSystemPrompt) {
        return buildCompletionRules(options.inferredSystemQuery, options.intentMode);
    }

    return applyCustomSystemPromptTemplate(options.customSystemPrompt, options);
}

export function applyCustomSystemPromptTemplate(
    template: string,
    options: Omit<InlineCompletionPromptRuleOptions, "customSystemPrompt">,
): string {
    let result = template;
    const replacements: Array<[string, string]> = [
        ["{{inferredSystemQuery}}", options.inferredSystemQuery ? "true" : "false"],
        ["{{intentMode}}", options.intentMode ? "true" : "false"],
        ["{{schemaContext}}", options.schemaContextText],
        ["{{linePrefix}}", options.linePrefix],
        ["{{recentPrefix}}", options.recentPrefix],
        ["{{statementPrefix}}", options.statementPrefix],
    ];

    for (const [placeholder, value] of replacements) {
        result = result.split(placeholder).join(value);
    }

    return result;
}

export function buildInlineCompletionPromptMessages(
    options: InlineCompletionPromptBuildOptions,
): vscode.LanguageModelChatMessage[] {
    // VS Code LM API exposes only User and Assistant roles; there is no System role.
    // The rules message is sent as User because that is the only available channel.
    return [
        vscode.LanguageModelChatMessage.User(options.rulesText),
        vscode.LanguageModelChatMessage.User(
            `Mode: ${options.intentMode ? "intent (return complete query)" : "continuation (return one unit)"}

Recent document prefix:
${options.recentPrefix}

Current statement prefix:
${options.statementPrefix}

Document suffix:
${options.suffix}

Current line prefix:
${options.linePrefix}

Current line suffix:
${options.lineSuffix}

Schema context:
${options.schemaContextText}`,
        ),
    ];
}

export function selectPreferredModel<T extends { family: string }>(models: T[]): T | undefined {
    for (const pattern of modelFamilyFallbackPreferences) {
        const match = models.find((m) => pattern.test(m.family));
        if (match) {
            return match;
        }
    }
    return models[0];
}

export async function collectText(
    response: vscode.LanguageModelChatResponse,
    token: vscode.CancellationToken,
): Promise<string> {
    const parts: string[] = [];
    for await (const part of response.stream) {
        if (token.isCancellationRequested) {
            break;
        }
        if (part instanceof vscode.LanguageModelTextPart) {
            parts.push(part.value);
        }
    }

    return parts.join("");
}

export function createLanguageModelMaxTokenOptions(maxTokens: number): { [name: string]: number } {
    return {
        maxTokens,
        max_tokens: maxTokens,
    };
}

export function getEffectiveMaxCompletionChars(
    defaultMaxChars: number,
    maxTokensOverride: number | null | undefined,
): number {
    if (
        maxTokensOverride === null ||
        maxTokensOverride === undefined ||
        !Number.isFinite(maxTokensOverride) ||
        maxTokensOverride <= 0
    ) {
        return defaultMaxChars;
    }

    return Math.max(1, Math.min(defaultMaxChars, Math.ceil(maxTokensOverride * 6)));
}

async function countLanguageModelTokens(
    model: vscode.LanguageModelChat,
    textOrMessages: string | vscode.LanguageModelChatMessage[],
    token: vscode.CancellationToken,
): Promise<number | undefined> {
    const countTokens = (model as { countTokens?: vscode.LanguageModelChat["countTokens"] })
        .countTokens;
    if (!countTokens || token.isCancellationRequested) {
        return undefined;
    }

    try {
        if (typeof textOrMessages === "string") {
            return await countTokens.call(model, textOrMessages, token);
        }

        const counts = await Promise.all(
            textOrMessages.map((message) => countTokens.call(model, message, token)),
        );
        return counts.reduce((sum, count) => sum + count, 0);
    } catch {
        return undefined;
    }
}

function toDebugPromptMessage(
    message: vscode.LanguageModelChatMessage,
): InlineCompletionDebugPromptMessage {
    return {
        role: message.role === vscode.LanguageModelChatMessageRole.Assistant ? "assistant" : "user",
        content: message.content
            .map((part) => (part instanceof vscode.LanguageModelTextPart ? part.value : ""))
            .join(""),
    };
}

// SQL keywords that start a new clause and should land on their own line when the
// cursor is at the end of the previous token with no trailing whitespace.
const newLineClausePattern =
    /^(with|where|from|join|left(?:\s+outer)?\s+join|right(?:\s+outer)?\s+join|inner\s+join|outer\s+join|cross\s+join|full(?:\s+outer)?\s+join|cross\s+apply|outer\s+apply|apply|group\s+by|order\s+by|having|union(?:\s+all)?|intersect|except|on|set|values|returning|output|pivot|unpivot|for\s+json|for\s+xml|window|option)\b/i;
const similaritySensitiveLeadingTokens = new Set([
    "select",
    "with",
    "from",
    "join",
    "left",
    "right",
    "inner",
    "full",
    "cross",
    "outer",
    "where",
    "group",
    "order",
    "having",
]);

export function fixLeadingWhitespace(
    completionText: string | undefined,
    linePrefix: string,
    schemaContext: SqlInlineCompletionSchemaContext | undefined,
    intentMode: boolean = false,
): string | undefined {
    if (!completionText) {
        return undefined;
    }

    if (!linePrefix.trim()) {
        return completionText.replace(/^\s+/, "");
    }

    if (intentMode && isIntentCommentLinePrefix(linePrefix)) {
        const indentation = /^\s*/.exec(linePrefix)?.[0] ?? "";
        return `\n${indentation}${completionText.replace(/^\s+/, "")}`;
    }

    if (isAfterStatementTerminator(linePrefix)) {
        return `\n${completionText.replace(/^\s+/, "")}`;
    }

    if (/[\s.]$/.test(linePrefix) || /^[\s.]/.test(completionText)) {
        return completionText;
    }

    if (/[@#\[(]$/.test(linePrefix)) {
        return completionText;
    }

    if (newLineClausePattern.test(completionText)) {
        return "\n" + completionText;
    }

    if (/^[a-zA-Z0-9_@#"'\[`]/.test(completionText)) {
        const trailingWord = /([a-zA-Z0-9_#@$]+)$/.exec(linePrefix)?.[1];
        if (
            trailingWord &&
            schemaContext &&
            isKnownDottedName(trailingWord, completionText, schemaContext)
        ) {
            return "." + completionText;
        }
        return " " + completionText;
    }
    return completionText;
}

function isAfterStatementTerminator(linePrefix: string): boolean {
    return /;\s*$/.test(linePrefix);
}

function isIntentCommentLinePrefix(linePrefix: string): boolean {
    const trimmedLinePrefix = linePrefix.trim();
    return /^\s*--/.test(linePrefix) || trimmedLinePrefix.endsWith("*/");
}

function shouldSuppressIntentCompletionOnCommentLine(
    linePrefix: string,
    lineSuffix: string,
): boolean {
    return isIntentCommentLinePrefix(linePrefix) && !!lineSuffix.trim();
}

export function suppressDocumentSuffixOverlap(
    completionText: string | undefined,
    documentSuffix: string,
): string | undefined {
    if (!completionText) {
        return undefined;
    }

    const normalizedCompletion = completionText.replace(/\r\n/g, "\n").trimStart();
    const normalizedSuffix = documentSuffix.replace(/\r\n/g, "\n").trimStart();
    if (!normalizedCompletion || !normalizedSuffix) {
        return completionText;
    }

    if (normalizedSuffix.startsWith(normalizedCompletion)) {
        const nextCharacter = normalizedSuffix[normalizedCompletion.length];
        if (
            nextCharacter &&
            /[a-zA-Z0-9_]/.test(nextCharacter) &&
            /[a-zA-Z0-9_]$/.test(normalizedCompletion)
        ) {
            return completionText;
        }

        return undefined;
    }

    if (isSimilarRewriteOfDocumentSuffix(normalizedCompletion, normalizedSuffix)) {
        return undefined;
    }

    return completionText;
}

function isSimilarRewriteOfDocumentSuffix(completionText: string, documentSuffix: string): boolean {
    const completionTokens = getSqlSimilarityTokens(completionText);
    const suffixTokens = getSqlSimilarityTokens(documentSuffix);
    if (completionTokens.length < 8 || suffixTokens.length < 8) {
        return false;
    }

    if (completionTokens[0] !== suffixTokens[0]) {
        return false;
    }

    if (!similaritySensitiveLeadingTokens.has(completionTokens[0])) {
        return false;
    }

    const suffixWindow = suffixTokens.slice(0, Math.max(completionTokens.length, 16));
    return getTokenSetSimilarity(completionTokens, suffixWindow) >= 0.78;
}

function getSqlSimilarityTokens(text: string): string[] {
    return (
        text
            .replace(/\[[^\]]+\]/g, (identifier) => identifier.slice(1, -1))
            .toLowerCase()
            .match(/[a-z_][a-z0-9_]*|#[a-z_][a-z0-9_]*|@[a-z_][a-z0-9_]*/g) ?? []
    );
}

function getTokenSetSimilarity(leftTokens: string[], rightTokens: string[]): number {
    const left = new Set(leftTokens);
    const right = new Set(rightTokens);
    let intersectionSize = 0;
    for (const token of left) {
        if (right.has(token)) {
            intersectionSize++;
        }
    }

    return intersectionSize / Math.max(left.size, right.size);
}

function isKnownDottedName(
    prefix: string,
    completion: string,
    context: SqlInlineCompletionSchemaContext,
): boolean {
    const firstCompletionToken = completion.split(/[\s(,;]/, 1)[0]?.replace(/^[.]+/, "");
    if (!firstCompletionToken) {
        return false;
    }

    const candidate = `${prefix}.${firstCompletionToken}`.toLowerCase();
    const objectNames = [
        ...context.tables.map((t) => t.name),
        ...context.views.map((v) => v.name),
        ...(context.systemObjects ?? []).map((o) => o.name),
        ...context.masterSymbols,
        ...context.schemas,
    ];

    return objectNames.some((name) => name.toLowerCase().startsWith(candidate));
}

function isCancellation(token: vscode.CancellationToken, error: unknown): boolean {
    if (token.isCancellationRequested) {
        return true;
    }
    if (error instanceof vscode.CancellationError) {
        return true;
    }
    if (error instanceof Error && error.message === "Canceled") {
        return true;
    }
    return false;
}

function delay(ms: number, token: vscode.CancellationToken): Promise<void> {
    if (token.isCancellationRequested) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            disposable.dispose();
            resolve();
        }, ms);
        const disposable = token.onCancellationRequested(() => {
            clearTimeout(timeout);
            disposable.dispose();
            resolve();
        });
    });
}

function getStatementAwarePrefixWindow(
    document: vscode.TextDocument,
    position: vscode.Position,
    targetMaxChars: number,
): string {
    const prefix = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
    const boundaryIndex = findLastStatementBoundary(prefix);
    const statementPrefix = prefix.slice(boundaryIndex).replace(/^\s+/, "");

    // Prefer preserving the full current statement because mid-statement truncation hurts
    // completion quality more than a slightly larger prompt, but clamp pathological statements
    // to a hard ceiling so giant single-statement scripts cannot grow unbounded.
    const hardCap = targetMaxChars * 2;
    if (statementPrefix.length > hardCap) {
        return statementPrefix.slice(-hardCap);
    }

    return statementPrefix;
}

function getRecentDocumentPrefixWindow(
    document: vscode.TextDocument,
    position: vscode.Position,
    maxChars: number,
): string {
    const prefix = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
    const boundaryIndex = findLastStatementBoundary(prefix);
    const recentPrefix = prefix.slice(0, boundaryIndex).trimEnd();
    if (!recentPrefix) {
        return "";
    }

    return recentPrefix.slice(-maxChars).replace(/^\s+/, "");
}

function findLastStatementBoundary(text: string): number {
    return Math.max(findLastGoBoundary(text), findLastTopLevelSemicolon(text));
}

function findLastGoBoundary(text: string): number {
    const goPattern = /(?:^|\r?\n)[ \t]*GO(?:[ \t]+\d+)?[ \t]*(?:--[^\r\n]*)?(?=\r?\n|$)/gi;
    let boundaryIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = goPattern.exec(text)) !== null) {
        boundaryIndex = match.index + match[0].length;
        if (text.slice(boundaryIndex, boundaryIndex + 2) === "\r\n") {
            boundaryIndex += 2;
        } else if (text[boundaryIndex] === "\n") {
            boundaryIndex += 1;
        }
    }

    return boundaryIndex;
}

function findLastTopLevelSemicolon(text: string): number {
    let lastBoundaryIndex = 0;
    let parenthesisDepth = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inBracketIdentifier = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < text.length; i++) {
        const current = text[i];
        const next = text[i + 1];

        if (inLineComment) {
            if (current === "\n" || current === "\r") {
                inLineComment = false;
            }
            continue;
        }

        if (inBlockComment) {
            if (current === "*" && next === "/") {
                inBlockComment = false;
                i++;
            }
            continue;
        }

        if (inSingleQuote) {
            if (current === "'" && next === "'") {
                i++;
            } else if (current === "'") {
                inSingleQuote = false;
            }
            continue;
        }

        if (inDoubleQuote) {
            if (current === '"' && next === '"') {
                i++;
            } else if (current === '"') {
                inDoubleQuote = false;
            }
            continue;
        }

        if (inBracketIdentifier) {
            if (current === "]" && next === "]") {
                i++;
            } else if (current === "]") {
                inBracketIdentifier = false;
            }
            continue;
        }

        if (current === "-" && next === "-") {
            inLineComment = true;
            i++;
            continue;
        }

        if (current === "/" && next === "*") {
            inBlockComment = true;
            i++;
            continue;
        }

        if (current === "'") {
            inSingleQuote = true;
            continue;
        }

        if (current === '"') {
            inDoubleQuote = true;
            continue;
        }

        if (current === "[") {
            inBracketIdentifier = true;
            continue;
        }

        if (current === "(") {
            parenthesisDepth++;
            continue;
        }

        if (current === ")" && parenthesisDepth > 0) {
            parenthesisDepth--;
            continue;
        }

        if (current === ";" && parenthesisDepth === 0) {
            lastBoundaryIndex = i + 1;
        }
    }

    return lastBoundaryIndex;
}

function getSuffixWindow(
    document: vscode.TextDocument,
    position: vscode.Position,
    maxChars: number,
): string {
    const endPosition = document.lineAt(document.lineCount - 1).range.end;
    const suffix = document.getText(new vscode.Range(position, endPosition));
    return suffix.slice(0, maxChars);
}

export function detectIntentComment(statementPrefix: string, linePrefix: string): boolean {
    const trimmedPrefix = statementPrefix.trimEnd();
    const intentComment = findIntentComment(trimmedPrefix);
    if (!intentComment) {
        return false;
    }

    if (!matchesIntentPostComment(intentComment.postComment)) {
        return false;
    }

    if (!matchesIntentLinePrefix(linePrefix)) {
        return false;
    }

    return (
        instructionalIntentWordPattern.test(intentComment.commentText) ||
        questionStyleIntentPattern.test(intentComment.commentText)
    );
}

// Both automatic and explicit (Alt+\) trigger kinds use comment-based detection as the
// single signal for intent mode. This is the canonical entry point for that check.
function detectIntentMode(statementPrefix: string, linePrefix: string): boolean {
    return detectIntentComment(statementPrefix, linePrefix);
}

export function sanitizeInlineCompletionText(
    completionText: string,
    maxChars: number,
    linePrefix: string,
    intentMode: boolean,
): string | undefined {
    let normalized = completionText.replace(/\r\n/g, "\n");
    normalized = stripMarkdownFences(normalized);
    normalized = stripModelPreamble(normalized);
    normalized = unwrapSingleQuotedResponse(unwrapDoubleQuotedResponse(normalized));
    normalized = intentMode ? normalized.trimEnd() : normalized.trim();

    if (isSentinelCompletion(normalized)) {
        return undefined;
    }

    normalized = removeEchoedLinePrefix(normalized, linePrefix);
    normalized = intentMode ? normalized.trimEnd() : normalized.trim();
    if (isLikelyMetaResponseInsteadOfSql(normalized)) {
        return undefined;
    }

    if (intentMode) {
        normalized = stripTrailingStandaloneLineComment(normalized).trimEnd();
        if (isLikelyMetaResponseInsteadOfSql(normalized)) {
            return undefined;
        }
    } else {
        normalized = truncateAtInlineStop(normalized).trim();
        if (isLikelyMetaResponseInsteadOfSql(normalized)) {
            return undefined;
        }
    }

    if (isSentinelCompletion(normalized)) {
        return undefined;
    }

    if (normalized.length <= maxChars) {
        return normalized;
    }

    const candidate = normalized.slice(0, maxChars);
    const lastWhitespaceIndex = Math.max(candidate.lastIndexOf(" "), candidate.lastIndexOf("\n"));
    if (lastWhitespaceIndex > Math.floor(maxChars / 2)) {
        return candidate.slice(0, lastWhitespaceIndex).trimEnd();
    }

    return candidate.trimEnd();
}

function stripMarkdownFences(text: string): string {
    const fencedBlock = /^\s*```(?:sql|tsql|sqlserver)?\s*([\s\S]*?)\s*```\s*$/i.exec(text);
    if (fencedBlock) {
        return fencedBlock[1];
    }

    return text.replace(/```(?:sql|tsql|sqlserver)?/gi, "").replace(/```/g, "");
}

function stripModelPreamble(text: string): string {
    return text.replace(/^\s*(?:completion|insert text|ghost text)\s*:\s*/i, "");
}

function unwrapDoubleQuotedResponse(text: string): string {
    const match = /^"([\s\S]*)"$/.exec(text);
    return match ? match[1] : text;
}

function unwrapSingleQuotedResponse(text: string): string {
    const match = /^'([\s\S]*)'$/.exec(text);
    return match ? match[1] : text;
}

function isSentinelCompletion(text: string): boolean {
    return (
        !text.trim() ||
        /^(?:""|''|none|no completion|n\/a|null|undefined|empty|string empty|empty string|\(none\))$/i.test(
            text.trim(),
        )
    );
}

function removeEchoedLinePrefix(completionText: string, linePrefix: string): string {
    const trimmedLinePrefix = linePrefix.trim();
    const trimmedCompletion = completionText.trimStart();

    if (trimmedLinePrefix.length < 6) {
        return completionText;
    }

    if (!trimmedCompletion.toLowerCase().startsWith(trimmedLinePrefix.toLowerCase())) {
        return completionText;
    }

    const nextCharacter = trimmedCompletion[trimmedLinePrefix.length];
    if (nextCharacter && /[a-zA-Z0-9_]/.test(nextCharacter)) {
        return completionText;
    }

    const remainder = trimmedCompletion.slice(trimmedLinePrefix.length);
    return /\s$/.test(linePrefix) ? remainder.trimStart() : remainder;
}

function truncateAtInlineStop(text: string): string {
    const stopIndexes = [text.indexOf("\n\n"), text.indexOf(";"), findLineCommentStop(text)].filter(
        (index) => index >= 0,
    );

    if (stopIndexes.length === 0) {
        return text;
    }

    return text.slice(0, Math.min(...stopIndexes)).trimEnd();
}

function findLineCommentStop(text: string): number {
    const match = /(?:^|\s)--/.exec(text);
    return match ? match.index : -1;
}

function stripTrailingStandaloneLineComment(text: string): string {
    const lines = text.split("\n");
    let lastNonEmptyLineIndex = lines.length - 1;
    while (lastNonEmptyLineIndex >= 0 && !lines[lastNonEmptyLineIndex].trim()) {
        lastNonEmptyLineIndex--;
    }

    if (lastNonEmptyLineIndex >= 0 && /^\s*--/.test(lines[lastNonEmptyLineIndex])) {
        return lines.slice(0, lastNonEmptyLineIndex).join("\n");
    }

    return text;
}

function isLikelyMetaResponseInsteadOfSql(text: string): boolean {
    const firstNonEmptyLine = text
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0);

    if (!firstNonEmptyLine) {
        return false;
    }

    return (
        metaResponseInsteadOfSqlPattern.test(firstNonEmptyLine) ||
        emptyStringInstructionEchoPattern.test(firstNonEmptyLine)
    );
}

export function formatSchemaContextForPrompt(
    schemaContext: SqlInlineCompletionSchemaContext | undefined,
    inferredSystemQuery: boolean,
): string {
    if (!schemaContext) {
        return "-- unavailable";
    }

    const lines: string[] = [];
    lines.push(
        `-- connection: ${schemaContext.server ?? "unknown server"} / ${
            schemaContext.database ?? "unknown database"
        }, default schema ${schemaContext.defaultSchema ?? "dbo"}, engine: ${
            schemaContext.engineEditionName ?? "unknown"
        }`,
    );
    lines.push(
        `-- inferred system query: ${
            (schemaContext.inferredSystemQuery ?? inferredSystemQuery) ? "yes" : "no"
        }`,
    );

    if (schemaContext.schemas.length > 0) {
        lines.push(`-- schemas (user): ${schemaContext.schemas.join(", ")}`);
    }

    const tableInventory = schemaContext.tableNameOnlyInventory ?? [];
    const viewInventory = schemaContext.viewNameOnlyInventory ?? [];
    const totalTableCount = Math.max(
        schemaContext.totalTableCount ?? schemaContext.tables.length + tableInventory.length,
        schemaContext.tables.length + tableInventory.length,
    );
    const totalViewCount = Math.max(
        schemaContext.totalViewCount ?? schemaContext.views.length + viewInventory.length,
        schemaContext.views.length + viewInventory.length,
    );

    if (totalTableCount > schemaContext.tables.length) {
        lines.push(`-- user tables: detailed ${schemaContext.tables.length} of ${totalTableCount}`);
    }

    for (const table of schemaContext.tables) {
        lines.push(`TABLE ${table.name} (${formatColumnsForPrompt(table)})`);
    }

    if (tableInventory.length > 0) {
        const unlistedTableCount = Math.max(
            0,
            totalTableCount - schemaContext.tables.length - tableInventory.length,
        );
        lines.push(
            `-- additional tables listed without columns${
                unlistedTableCount > 0 ? ` (${unlistedTableCount} more omitted)` : ""
            }:`,
        );
        lines.push(...formatQualifiedNameInventoryForPrompt("TABLE NAMES", tableInventory));
    }

    if (totalViewCount > schemaContext.views.length) {
        lines.push(`-- user views: detailed ${schemaContext.views.length} of ${totalViewCount}`);
    }

    for (const view of schemaContext.views) {
        lines.push(`VIEW ${view.name} (${formatColumnsForPrompt(view)})`);
    }

    if (viewInventory.length > 0) {
        const unlistedViewCount = Math.max(
            0,
            totalViewCount - schemaContext.views.length - viewInventory.length,
        );
        lines.push(
            `-- additional views listed without columns${
                unlistedViewCount > 0 ? ` (${unlistedViewCount} more omitted)` : ""
            }:`,
        );
        lines.push(...formatQualifiedNameInventoryForPrompt("VIEW NAMES", viewInventory));
    }

    if ((schemaContext.systemObjects ?? []).length > 0) {
        lines.push("-- system catalog / DMVs available:");
        for (const object of schemaContext.systemObjects ?? []) {
            lines.push(`${object.name} (${formatColumnsForPrompt(object)})`);
        }
    }

    if (schemaContext.masterSymbols.length > 0) {
        lines.push(`-- master symbols: ${schemaContext.masterSymbols.join(", ")}`);
    }

    return lines.join("\n");
}

function formatColumnsForPrompt(object: SqlInlineCompletionSchemaObject): string {
    const columns = object.columnDefinitions?.length ? object.columnDefinitions : object.columns;
    if (columns.length === 0) {
        return "columns unknown";
    }

    return columns.map(sanitizePromptFragment).join(", ");
}

function formatQualifiedNameInventoryForPrompt(prefix: string, qualifiedNames: string[]): string[] {
    const namesBySchema = new Map<string, string[]>();
    for (const qualifiedName of qualifiedNames) {
        const [schemaName, objectName] = splitQualifiedName(qualifiedName);
        const key = schemaName ?? "";
        const existing = namesBySchema.get(key) ?? [];
        existing.push(objectName);
        namesBySchema.set(key, existing);
    }

    const lines: string[] = [];
    for (const [schemaName, objectNames] of namesBySchema) {
        for (const chunk of chunkStrings(objectNames, 8)) {
            if (schemaName) {
                lines.push(`${prefix} ${schemaName} (${chunk.join(", ")})`);
                continue;
            }

            lines.push(`${prefix} (${chunk.join(", ")})`);
        }
    }

    return lines;
}

function splitQualifiedName(qualifiedName: string): [string | undefined, string] {
    const separatorIndex = qualifiedName.indexOf(".");
    if (separatorIndex <= 0 || separatorIndex === qualifiedName.length - 1) {
        return [undefined, qualifiedName];
    }

    return [qualifiedName.slice(0, separatorIndex), qualifiedName.slice(separatorIndex + 1)];
}

function chunkStrings(values: string[], chunkSize: number): string[][] {
    const chunks: string[][] = [];
    for (let index = 0; index < values.length; index += chunkSize) {
        chunks.push(values.slice(index, index + chunkSize));
    }

    return chunks;
}

function sanitizePromptFragment(value: string): string {
    return value.replace(/[\r\n]+/g, " ").trim();
}

function inferSystemQuery(statementPrefix: string, linePrefix: string): boolean {
    return /\b(?:sys|INFORMATION_SCHEMA)\s*\./i.test(`${statementPrefix}\n${linePrefix}`);
}

function withInferredSystemQuery(
    schemaContext: SqlInlineCompletionSchemaContext | undefined,
    inferredSystemQuery: boolean,
): SqlInlineCompletionSchemaContext | undefined {
    if (!schemaContext) {
        return undefined;
    }

    return {
        ...schemaContext,
        inferredSystemQuery,
    };
}

function createInlineTelemetrySnapshot(
    schemaContext: SqlInlineCompletionSchemaContext | undefined,
    modelFamily: string | undefined,
    startedAt: number,
    triggerKind: vscode.InlineCompletionTriggerKind,
    inferredSystemQuery: boolean,
    intentMode: boolean,
): InlineCompletionTelemetrySnapshot {
    const usedSchemaContext = !!schemaContext;
    return {
        usedSchemaContext,
        fallbackWithoutMetadata: !usedSchemaContext,
        schemaObjectCount: (schemaContext?.tables.length ?? 0) + (schemaContext?.views.length ?? 0),
        schemaSystemObjectCount:
            (schemaContext?.systemObjects?.length ?? 0) +
            (schemaContext?.masterSymbols.length ?? 0),
        schemaForeignKeyCount: getForeignKeyCount(schemaContext),
        modelFamily: modelFamily ?? "unknown",
        triggerKind: getTriggerKindName(triggerKind),
        latencyMs: Date.now() - startedAt,
        inferredSystemQuery,
        intentMode,
    };
}

function getForeignKeyCount(schemaContext: SqlInlineCompletionSchemaContext | undefined): number {
    return (schemaContext?.tables ?? []).reduce(
        (sum, table) => sum + (table.foreignKeys?.length ?? 0),
        0,
    );
}

function getTriggerKindName(
    triggerKind: vscode.InlineCompletionTriggerKind,
): "automatic" | "invoke" {
    return triggerKind === vscode.InlineCompletionTriggerKind.Automatic ? "automatic" : "invoke";
}

function getLatencyBucket(latencyMs: number): string {
    if (latencyMs < 100) {
        return "<100";
    }

    if (latencyMs < 300) {
        return "100-300";
    }

    if (latencyMs < 800) {
        return "300-800";
    }

    if (latencyMs < 2000) {
        return "800-2000";
    }

    return "2000+";
}

function getCountBucket(count: number): string {
    if (count === 0) {
        return "0";
    }

    if (count <= 5) {
        return "1-5";
    }

    if (count <= 10) {
        return "6-10";
    }

    if (count <= 20) {
        return "11-20";
    }

    return "20+";
}

type IntentCommentMatch = {
    commentText: string;
    postComment: string;
};

function findIntentComment(trimmedPrefix: string): IntentCommentMatch | undefined {
    return (
        findTrailingLineIntentComment(trimmedPrefix) ??
        findTrailingBlockIntentComment(trimmedPrefix)
    );
}

function findTrailingLineIntentComment(trimmedPrefix: string): IntentCommentMatch | undefined {
    if (!trimmedPrefix) {
        return undefined;
    }

    const lines = getTextLines(trimmedPrefix);
    const lastLine = lines[lines.length - 1];
    if (!lastLine) {
        return undefined;
    }

    let postCommentStart = trimmedPrefix.length;
    if (isStatementInitiatingKeyword(lastLine.text.trim())) {
        postCommentStart = lastLine.start;
    } else if (!isLineCommentOnly(lastLine.text)) {
        return undefined;
    }

    let commentEndLineIndex = lines.length - 1;
    if (postCommentStart !== trimmedPrefix.length) {
        commentEndLineIndex = findLastNonEmptyLineBefore(lines, lastLine.start);
        if (commentEndLineIndex < 0) {
            return undefined;
        }
    }

    if (!isLineCommentOnly(lines[commentEndLineIndex].text)) {
        return undefined;
    }

    let commentStartLineIndex = commentEndLineIndex;
    while (commentStartLineIndex > 0 && isLineCommentOnly(lines[commentStartLineIndex - 1].text)) {
        commentStartLineIndex--;
    }

    const commentEnd = lines[commentEndLineIndex].end;
    const commentText = lines
        .slice(commentStartLineIndex, commentEndLineIndex + 1)
        .map((line) => line.text.replace(/^\s*--\s?/, "").trim())
        .join(" ")
        .trim();

    if (!commentText) {
        return undefined;
    }

    return {
        commentText,
        postComment: trimmedPrefix.slice(commentEnd),
    };
}

function findTrailingBlockIntentComment(trimmedPrefix: string): IntentCommentMatch | undefined {
    if (!trimmedPrefix) {
        return undefined;
    }

    const lines = getTextLines(trimmedPrefix);
    const lastLine = lines[lines.length - 1];
    if (!lastLine) {
        return undefined;
    }

    let postCommentStart = trimmedPrefix.length;
    if (isStatementInitiatingKeyword(lastLine.text.trim())) {
        postCommentStart = lastLine.start;
    }

    const prefixBeforePostComment = trimmedPrefix.slice(0, postCommentStart);
    const commentCandidate = prefixBeforePostComment.trimEnd();
    if (!commentCandidate.endsWith("*/")) {
        return undefined;
    }

    const commentStart = findMatchingBlockCommentStart(commentCandidate);
    if (commentStart === undefined) {
        return undefined;
    }

    const commentText = commentCandidate
        .slice(commentStart + 2, commentCandidate.length - 2)
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*\*?\s?/, "").trim())
        .join(" ")
        .trim();

    if (!commentText) {
        return undefined;
    }

    return {
        commentText,
        postComment: trimmedPrefix.slice(commentCandidate.length),
    };
}

function findMatchingBlockCommentStart(text: string): number | undefined {
    const blockCommentStarts: number[] = [];

    for (let i = 0; i < text.length - 1; i++) {
        if (text[i] === "/" && text[i + 1] === "*") {
            blockCommentStarts.push(i);
            i++;
            continue;
        }

        if (text[i] === "*" && text[i + 1] === "/") {
            const start = blockCommentStarts.pop();
            if (start === undefined) {
                return undefined;
            }

            if (i + 2 === text.length) {
                return start;
            }

            i++;
        }
    }

    return undefined;
}

function matchesIntentPostComment(postComment: string): boolean {
    return !postComment.trim() || statementInitiatingPostCommentPattern.test(postComment);
}

function matchesIntentLinePrefix(linePrefix: string): boolean {
    const trimmedLinePrefix = linePrefix.trim();
    return (
        !trimmedLinePrefix ||
        isStatementInitiatingKeyword(trimmedLinePrefix) ||
        /^\s*--/.test(linePrefix) ||
        trimmedLinePrefix.includes("*/")
    );
}

function isStatementInitiatingKeyword(text: string): boolean {
    return statementInitiatingKeywordPattern.test(text);
}

function isLineCommentOnly(text: string): boolean {
    return /^\s*--/.test(text);
}

function getTextLines(text: string): { text: string; start: number; end: number }[] {
    const result: { text: string; start: number; end: number }[] = [];
    const linePattern = /.*(?:\r?\n|$)/g;
    let match: RegExpExecArray | null;

    while ((match = linePattern.exec(text)) !== null) {
        const rawLine = match[0];
        if (!rawLine && match.index === text.length) {
            break;
        }

        const line = rawLine.replace(/\r?\n$/, "");
        result.push({
            text: line,
            start: match.index,
            end: match.index + line.length,
        });

        if (!rawLine) {
            break;
        }
    }

    return result;
}

function findLastNonEmptyLineBefore(
    lines: { text: string; start: number; end: number }[],
    beforeOffset: number,
): number {
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].start >= beforeOffset) {
            continue;
        }

        if (lines[i].text.trim()) {
            return i;
        }
    }

    return -1;
}
