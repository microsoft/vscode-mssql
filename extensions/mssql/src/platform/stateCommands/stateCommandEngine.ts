/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    NoopStateCommandDiagnosticsSink,
    StateCommandDiagnosticsSink,
    StateCommandSource,
} from "./stateCommandDiagnostics";

export interface StateCommandFailure {
    reason: string;
    message: string;
}

export type StateCommandMutationResult =
    | { success: true }
    | ({ success: false } & StateCommandFailure);

export interface AtomicStateCommandApplyRequest<TState, TCommand> {
    feature: string;
    source?: StateCommandSource;
    sessionId?: string;
    baseState: TState;
    commands: TCommand[];
    cloneState: (state: TState) => TState;
    getCommandType: (command: TCommand) => string;
    applyCommand: (
        candidate: TState,
        command: TCommand,
        index: number,
    ) => StateCommandMutationResult;
    validateState?: (candidate: TState, index: number) => StateCommandMutationResult;
    diagnostics?: StateCommandDiagnosticsSink;
}

export type AtomicStateCommandApplyResult<TState> =
    | {
          success: true;
          state: TState;
          appliedCommands: number;
      }
    | {
          success: false;
          reason: string;
          message: string;
          failedCommandIndex: number;
          state: TState;
          appliedCommands: 0;
      };

export function applyAtomicStateCommands<TState, TCommand>(
    request: AtomicStateCommandApplyRequest<TState, TCommand>,
): AtomicStateCommandApplyResult<TState> {
    const diagnostics = request.diagnostics ?? NoopStateCommandDiagnosticsSink;
    const startedAt = performance.now();

    diagnostics.emit({
        feature: request.feature,
        source: request.source,
        sessionId: request.sessionId,
        stage: "apply_batch",
        status: "started",
        commandCount: request.commands.length,
    });

    const candidate = request.cloneState(request.baseState);

    for (let index = 0; index < request.commands.length; index++) {
        const command = request.commands[index];
        const commandType = request.getCommandType(command);
        diagnostics.emit({
            feature: request.feature,
            source: request.source,
            sessionId: request.sessionId,
            stage: "apply_command",
            status: "started",
            commandIndex: index,
            commandType,
        });

        const applyResult = request.applyCommand(candidate, command, index);
        if (applyResult.success === false) {
            diagnostics.emit({
                feature: request.feature,
                source: request.source,
                sessionId: request.sessionId,
                stage: "apply_command",
                status: "failed",
                commandIndex: index,
                commandType,
                reason: applyResult.reason,
                message: applyResult.message,
            });
            diagnostics.emit({
                feature: request.feature,
                source: request.source,
                sessionId: request.sessionId,
                stage: "apply_batch",
                status: "failed",
                commandCount: request.commands.length,
                reason: applyResult.reason,
                message: applyResult.message,
                elapsedMs: Math.round(performance.now() - startedAt),
            });
            return {
                success: false,
                reason: applyResult.reason,
                message: applyResult.message,
                failedCommandIndex: index,
                state: request.baseState,
                appliedCommands: 0,
            };
        }

        diagnostics.emit({
            feature: request.feature,
            source: request.source,
            sessionId: request.sessionId,
            stage: "apply_command",
            status: "succeeded",
            commandIndex: index,
            commandType,
        });

        if (request.validateState) {
            diagnostics.emit({
                feature: request.feature,
                source: request.source,
                sessionId: request.sessionId,
                stage: "validate_state",
                status: "started",
                commandIndex: index,
            });
            const validation = request.validateState(candidate, index);
            if (validation.success === false) {
                diagnostics.emit({
                    feature: request.feature,
                    source: request.source,
                    sessionId: request.sessionId,
                    stage: "validate_state",
                    status: "failed",
                    commandIndex: index,
                    reason: validation.reason,
                    message: validation.message,
                });
                diagnostics.emit({
                    feature: request.feature,
                    source: request.source,
                    sessionId: request.sessionId,
                    stage: "apply_batch",
                    status: "failed",
                    commandCount: request.commands.length,
                    reason: validation.reason,
                    message: validation.message,
                    elapsedMs: Math.round(performance.now() - startedAt),
                });
                return {
                    success: false,
                    reason: validation.reason,
                    message: validation.message,
                    failedCommandIndex: index,
                    state: request.baseState,
                    appliedCommands: 0,
                };
            }
            diagnostics.emit({
                feature: request.feature,
                source: request.source,
                sessionId: request.sessionId,
                stage: "validate_state",
                status: "succeeded",
                commandIndex: index,
            });
        }
    }

    diagnostics.emit({
        feature: request.feature,
        source: request.source,
        sessionId: request.sessionId,
        stage: "apply_batch",
        status: "succeeded",
        commandCount: request.commands.length,
        elapsedMs: Math.round(performance.now() - startedAt),
    });

    return {
        success: true,
        state: candidate,
        appliedCommands: request.commands.length,
    };
}
