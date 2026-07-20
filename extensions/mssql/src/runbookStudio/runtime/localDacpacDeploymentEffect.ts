/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Failure-injectable critical section for an at-most-once DACPAC publish.
 * The caller durably prepares the effect before entering. Failures before the
 * publish call are proven no-effect; once publish is invoked, any failure is an
 * unknown outcome and must remain recoverable/operator-visible.
 */

export type LocalDacpacDeploymentEffectFailure = "connectFailed" | "deploymentFailed";

export class LocalDacpacDeploymentEffectError extends Error {
    constructor(public readonly reason: LocalDacpacDeploymentEffectFailure) {
        super(`Local DACPAC deployment effect failed: ${reason}`);
        this.name = "LocalDacpacDeploymentEffectError";
    }
}

export interface LocalDacpacPublishResult {
    success: boolean;
    operationId: string;
}

export interface LocalDacpacDeploymentEffectOperations {
    connect(): Promise<boolean>;
    verifyStagedArtifact(): Promise<void>;
    /** Deliberately accepts no cancellation token. Once entered, the caller
     * must await the server-side mutation instead of racing cleanup. */
    publish(): Promise<LocalDacpacPublishResult>;
    recordObserved(operationId: string): void;
    recordNoEffectFailure(reason: "DeploymentNotStarted"): void;
    disconnect(): Promise<void>;
}

export async function executeLocalDacpacDeploymentEffect(
    operations: LocalDacpacDeploymentEffectOperations,
): Promise<LocalDacpacPublishResult> {
    let connected = false;
    let deploymentStarted = false;
    try {
        connected = await operations.connect();
        if (!connected) {
            throw new LocalDacpacDeploymentEffectError("connectFailed");
        }
        await operations.verifyStagedArtifact();
        deploymentStarted = true;
        const result = await operations.publish();
        if (!result.success) {
            throw new LocalDacpacDeploymentEffectError("deploymentFailed");
        }
        operations.recordObserved(result.operationId);
        return result;
    } catch (error) {
        if (!deploymentStarted) {
            operations.recordNoEffectFailure("DeploymentNotStarted");
        }
        throw error;
    } finally {
        if (connected) {
            try {
                await operations.disconnect();
            } catch {
                // A settled/unknown durable effect is authoritative; transport
                // teardown cannot rewrite the mutation outcome.
            }
        }
    }
}
