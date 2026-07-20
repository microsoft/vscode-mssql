/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    executeLocalDacpacDeploymentEffect,
    LocalDacpacDeploymentEffectError,
    type LocalDacpacDeploymentEffectOperations,
} from "../../src/runbookStudio/runtime/localDacpacDeploymentEffect";

suite("Runbook Studio local DACPAC deployment effect", () => {
    function operations(
        overrides: Partial<LocalDacpacDeploymentEffectOperations> = {},
    ): LocalDacpacDeploymentEffectOperations & {
        events: string[];
    } {
        const events: string[] = [];
        return {
            events,
            connect: async () => {
                events.push("connect");
                return true;
            },
            verifyStagedArtifact: async () => {
                events.push("verify");
            },
            publish: async () => {
                events.push("publish");
                return { success: true, operationId: "publish-1" };
            },
            recordObserved: (operationId) => {
                events.push(`observed:${operationId}`);
            },
            recordNoEffectFailure: (reason) => {
                events.push(`no-effect:${reason}`);
            },
            disconnect: async () => {
                events.push("disconnect");
            },
            ...overrides,
        };
    }

    test("records success before disconnecting", async () => {
        const ops = operations();
        const result = await executeLocalDacpacDeploymentEffect(ops);

        expect(result).to.deep.equal({ success: true, operationId: "publish-1" });
        expect(ops.events).to.deep.equal([
            "connect",
            "verify",
            "publish",
            "observed:publish-1",
            "disconnect",
        ]);
    });

    test("connection refusal is durably classified as no effect", async () => {
        const events: string[] = [];
        const ops = operations({
            connect: async () => {
                events.push("connect-refused");
                return false;
            },
            recordNoEffectFailure: (reason) => events.push(`no-effect:${reason}`),
            publish: async () => {
                events.push("unexpected-publish");
                return { success: true, operationId: "unexpected" };
            },
            disconnect: async () => {
                events.push("unexpected-disconnect");
            },
        });

        const error = await captureFailure(executeLocalDacpacDeploymentEffect(ops));
        expect(error).to.be.instanceOf(LocalDacpacDeploymentEffectError);
        expect((error as LocalDacpacDeploymentEffectError).reason).to.equal("connectFailed");
        expect(events).to.deep.equal(["connect-refused", "no-effect:DeploymentNotStarted"]);
    });

    test("stage verification failure records no effect and disconnects", async () => {
        const events: string[] = [];
        const expected = new Error("injected stage drift");
        const ops = operations({
            connect: async () => {
                events.push("connect");
                return true;
            },
            verifyStagedArtifact: async () => {
                events.push("verify-failed");
                throw expected;
            },
            recordNoEffectFailure: (reason) => events.push(`no-effect:${reason}`),
            disconnect: async () => {
                events.push("disconnect");
            },
        });

        expect(await captureFailure(executeLocalDacpacDeploymentEffect(ops))).to.equal(expected);
        expect(events).to.deep.equal([
            "connect",
            "verify-failed",
            "no-effect:DeploymentNotStarted",
            "disconnect",
        ]);
    });

    test("publish rejection remains an unknown effect outcome", async () => {
        const events: string[] = [];
        const ops = operations({
            publish: async () => {
                events.push("publish-rejected");
                return { success: false, operationId: "publish-rejected" };
            },
            recordNoEffectFailure: (reason) => events.push(`unexpected-no-effect:${reason}`),
            disconnect: async () => {
                events.push("disconnect");
            },
        });

        const error = await captureFailure(executeLocalDacpacDeploymentEffect(ops));
        expect(error).to.be.instanceOf(LocalDacpacDeploymentEffectError);
        expect((error as LocalDacpacDeploymentEffectError).reason).to.equal("deploymentFailed");
        expect(events).to.deep.equal(["publish-rejected", "disconnect"]);
    });

    test("publish transport failure remains unknown and disconnects", async () => {
        const events: string[] = [];
        const expected = new Error("injected transport failure");
        const ops = operations({
            publish: async () => {
                events.push("publish-threw");
                throw expected;
            },
            recordNoEffectFailure: (reason) => events.push(`unexpected-no-effect:${reason}`),
            disconnect: async () => {
                events.push("disconnect");
            },
        });

        expect(await captureFailure(executeLocalDacpacDeploymentEffect(ops))).to.equal(expected);
        expect(events).to.deep.equal(["publish-threw", "disconnect"]);
    });

    test("cancellation observed during publish cannot abandon the critical section", async () => {
        let cancelled = false;
        const events: string[] = [];
        const ops = operations({
            verifyStagedArtifact: async () => {
                events.push(`verify-cancelled:${cancelled}`);
            },
            publish: async () => {
                events.push("publish-start");
                cancelled = true;
                await Promise.resolve();
                events.push("publish-settled");
                return { success: true, operationId: "publish-after-cancel" };
            },
            recordObserved: (operationId) => events.push(`observed:${operationId}`),
            disconnect: async () => {
                events.push("disconnect");
            },
        });

        await executeLocalDacpacDeploymentEffect(ops);
        expect(cancelled).to.equal(true);
        expect(events).to.deep.equal([
            "verify-cancelled:false",
            "publish-start",
            "publish-settled",
            "observed:publish-after-cancel",
            "disconnect",
        ]);
    });

    test("disconnect failure cannot erase an observed successful effect", async () => {
        const events: string[] = [];
        const ops = operations({
            recordObserved: (operationId) => events.push(`observed:${operationId}`),
            disconnect: async () => {
                events.push("disconnect-failed");
                throw new Error("injected disconnect failure");
            },
        });

        const result = await executeLocalDacpacDeploymentEffect(ops);
        expect(result.operationId).to.equal("publish-1");
        expect(events).to.deep.equal(["observed:publish-1", "disconnect-failed"]);
    });
});

async function captureFailure(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
        throw new Error("expected operation to fail");
    } catch (error) {
        return error;
    }
}
