/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Failure-injectable critical section for stored-procedure test execution.
 * Once the fixed tSQLt batch starts, the host waits for the server outcome;
 * cancellation cannot race target cleanup through this boundary.
 */

export class LocalTsqltEffectError extends Error {
    constructor(public readonly reason: "connectFailed" | "executionFailed") {
        super(`Local tSQLt effect failed: ${reason}`);
        this.name = "LocalTsqltEffectError";
    }
}

export interface LocalTsqltEffectOperations<TResult> {
    connect(): Promise<boolean>;
    execute(): Promise<TResult>;
    recordObserved(result: TResult): void;
    recordNoEffectFailure(reason: "TsqltExecutionNotStarted"): void;
    disconnect(): Promise<void>;
}

export async function executeLocalTsqltEffect<TResult>(
    operations: LocalTsqltEffectOperations<TResult>,
): Promise<TResult> {
    let connected = false;
    let executionStarted = false;
    try {
        connected = await operations.connect();
        if (!connected) {
            throw new LocalTsqltEffectError("connectFailed");
        }
        executionStarted = true;
        const result = await operations.execute();
        operations.recordObserved(result);
        return result;
    } catch (error) {
        if (!executionStarted) {
            operations.recordNoEffectFailure("TsqltExecutionNotStarted");
        }
        if (error instanceof LocalTsqltEffectError) {
            throw error;
        }
        throw new LocalTsqltEffectError("executionFailed");
    } finally {
        if (connected) {
            try {
                await operations.disconnect();
            } catch {
                // Durable effect state is authoritative; disconnect failure
                // cannot rewrite a settled or unknown execution outcome.
            }
        }
    }
}
