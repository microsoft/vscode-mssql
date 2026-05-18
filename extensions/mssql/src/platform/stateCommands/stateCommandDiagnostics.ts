/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type StateCommandDiagnosticStage =
    | "get_state"
    | "apply_batch"
    | "apply_command"
    | "validate_state"
    | "commit"
    | "publish_snapshot"
    | "publish_apply_failure";

export type StateCommandDiagnosticStatus = "started" | "succeeded" | "failed" | "skipped";

export type StateCommandSource = "ux" | "mcp" | "copilot" | "host" | "unknown";

export interface StateCommandDiagnosticEvent {
    feature: string;
    source?: StateCommandSource;
    stage: StateCommandDiagnosticStage;
    status: StateCommandDiagnosticStatus;
    sessionId?: string;
    commandType?: string;
    commandIndex?: number;
    commandCount?: number;
    reason?: string;
    message?: string;
    version?: string;
    elapsedMs?: number;
    measurements?: Record<string, number>;
}

export interface StateCommandDiagnosticsSink {
    emit(event: StateCommandDiagnosticEvent): void;
}

export const NoopStateCommandDiagnosticsSink: StateCommandDiagnosticsSink = {
    emit: () => undefined,
};

export class InMemoryStateCommandDiagnosticsSink implements StateCommandDiagnosticsSink {
    public readonly events: StateCommandDiagnosticEvent[] = [];

    public emit(event: StateCommandDiagnosticEvent): void {
        this.events.push(event);
    }
}

export type StateCommandDiagnosticListener = (event: StateCommandDiagnosticEvent) => void;

export class StateCommandDiagnosticEmitter implements StateCommandDiagnosticsSink {
    private readonly listeners = new Set<StateCommandDiagnosticListener>();

    public emit(event: StateCommandDiagnosticEvent): void {
        for (const listener of this.listeners) {
            listener(event);
        }
    }

    public subscribe(listener: StateCommandDiagnosticListener): { dispose: () => void } {
        this.listeners.add(listener);
        return {
            dispose: () => {
                this.listeners.delete(listener);
            },
        };
    }
}

export class CompositeStateCommandDiagnosticsSink implements StateCommandDiagnosticsSink {
    constructor(private readonly sinks: StateCommandDiagnosticsSink[]) {}

    public emit(event: StateCommandDiagnosticEvent): void {
        for (const sink of this.sinks) {
            sink.emit(event);
        }
    }
}
