/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { uuid } from "../utils/utils";
import {
    NoopStateCommandDiagnosticsSink,
    StateCommandDiagnosticsSink,
} from "../platform/stateCommands/stateCommandDiagnostics";

export interface OperationValidationIssue {
    property?: string;
    message: string;
    severity: "error" | "warning";
}

export interface OperationSummary {
    title: string;
    details: Record<string, string | number | boolean | undefined>;
}

export interface OperationContext {
    ownerUri?: string;
    databaseName?: string;
}

export interface OperationExecutionContext extends OperationContext {
    confirmed: boolean;
}

export interface OperationDefinition<TDraft, TResult, TCommand> {
    kind: string;
    createDefaultDraft(context: OperationContext): Promise<TDraft> | TDraft;
    applyCommand(draft: TDraft, command: TCommand): TDraft;
    validate(draft: TDraft, context: OperationContext): OperationValidationIssue[];
    summarize(draft: TDraft): OperationSummary;
    redact(draft: TDraft): unknown;
    execute(draft: TDraft, context: OperationExecutionContext): Promise<TResult>;
}

export type OperationSessionStatus =
    | "draft"
    | "ready"
    | "awaiting_confirmation"
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled";

export interface OperationSession<TDraft, TResult> {
    id: string;
    kind: string;
    draft: TDraft;
    version: number;
    validation: OperationValidationIssue[];
    status: OperationSessionStatus;
    summary: OperationSummary;
    result?: TResult;
    error?: string;
}

export class OperationSessionService {
    private readonly sessions = new Map<string, OperationSession<unknown, unknown>>();

    constructor(
        private readonly diagnostics: StateCommandDiagnosticsSink = NoopStateCommandDiagnosticsSink,
    ) {}

    public async createSession<TDraft, TResult, TCommand>(
        definition: OperationDefinition<TDraft, TResult, TCommand>,
        context: OperationContext,
    ): Promise<OperationSession<TDraft, TResult>> {
        const draft = await definition.createDefaultDraft(context);
        const session = this.createSessionFromDraft(definition, draft, context);
        this.sessions.set(session.id, session as OperationSession<unknown, unknown>);
        this.diagnostics.emit({
            feature: definition.kind,
            sessionId: session.id,
            stage: "get_state",
            status: "succeeded",
            version: session.version.toString(),
        });
        return session;
    }

    public applyCommand<TDraft, TResult, TCommand>(
        sessionId: string,
        definition: OperationDefinition<TDraft, TResult, TCommand>,
        command: TCommand,
        context: OperationContext,
    ): OperationSession<TDraft, TResult> {
        const session = this.getSession<TDraft, TResult>(sessionId, definition.kind);
        this.diagnostics.emit({
            feature: definition.kind,
            sessionId,
            stage: "apply_command",
            status: "started",
            commandType: this.getCommandType(command),
            version: session.version.toString(),
        });
        const draft = definition.applyCommand(session.draft, command);
        const nextSession = this.createSessionFromDraft(definition, draft, context, session);
        this.sessions.set(sessionId, nextSession as OperationSession<unknown, unknown>);
        this.diagnostics.emit({
            feature: definition.kind,
            sessionId,
            stage: "apply_command",
            status: "succeeded",
            commandType: this.getCommandType(command),
            version: nextSession.version.toString(),
        });
        return nextSession;
    }

    public getSession<TDraft, TResult>(
        sessionId: string,
        expectedKind?: string,
    ): OperationSession<TDraft, TResult> {
        const session = this.sessions.get(sessionId) as
            | OperationSession<TDraft, TResult>
            | undefined;
        if (!session) {
            throw new Error(`Operation session not found: ${sessionId}`);
        }
        if (expectedKind && session.kind !== expectedKind) {
            throw new Error(`Operation session '${sessionId}' is not a '${expectedKind}' session.`);
        }
        return session;
    }

    public async execute<TDraft, TResult, TCommand>(
        sessionId: string,
        definition: OperationDefinition<TDraft, TResult, TCommand>,
        context: OperationExecutionContext,
    ): Promise<OperationSession<TDraft, TResult>> {
        const session = this.getSession<TDraft, TResult>(sessionId, definition.kind);
        if (!context.confirmed) {
            this.diagnostics.emit({
                feature: definition.kind,
                sessionId,
                stage: "commit",
                status: "skipped",
                reason: "confirmation_required",
                version: session.version.toString(),
            });
            return {
                ...session,
                status: "awaiting_confirmation",
            };
        }

        const runningSession: OperationSession<TDraft, TResult> = {
            ...session,
            status: "running",
        };
        this.sessions.set(sessionId, runningSession as OperationSession<unknown, unknown>);
        this.diagnostics.emit({
            feature: definition.kind,
            sessionId,
            stage: "commit",
            status: "started",
            version: runningSession.version.toString(),
        });

        try {
            const result = await definition.execute(runningSession.draft, context);
            const succeeded: OperationSession<TDraft, TResult> = {
                ...runningSession,
                status: "succeeded",
                result,
            };
            this.sessions.set(sessionId, succeeded as OperationSession<unknown, unknown>);
            this.diagnostics.emit({
                feature: definition.kind,
                sessionId,
                stage: "commit",
                status: "succeeded",
                version: succeeded.version.toString(),
            });
            return succeeded;
        } catch (error) {
            const failed: OperationSession<TDraft, TResult> = {
                ...runningSession,
                status: "failed",
                error: error instanceof Error ? error.message : String(error),
            };
            this.sessions.set(sessionId, failed as OperationSession<unknown, unknown>);
            this.diagnostics.emit({
                feature: definition.kind,
                sessionId,
                stage: "commit",
                status: "failed",
                reason: "execution_error",
                message: failed.error,
                version: failed.version.toString(),
            });
            return failed;
        }
    }

    private getCommandType(command: unknown): string {
        return typeof command === "object" &&
            command !== null &&
            "type" in command &&
            typeof (command as { type?: unknown }).type === "string"
            ? (command as { type: string }).type
            : "unknown";
    }

    private createSessionFromDraft<TDraft, TResult, TCommand>(
        definition: OperationDefinition<TDraft, TResult, TCommand>,
        draft: TDraft,
        context: OperationContext,
        previous?: OperationSession<TDraft, TResult>,
    ): OperationSession<TDraft, TResult> {
        const validation = definition.validate(draft, context);
        return {
            id: previous?.id ?? uuid(),
            kind: definition.kind,
            draft,
            version: (previous?.version ?? 0) + 1,
            validation,
            status: validation.some((issue) => issue.severity === "error") ? "draft" : "ready",
            summary: definition.summarize(draft),
            result: previous?.result,
            error: undefined,
        };
    }
}
