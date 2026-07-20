/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    executeLocalTsqltEffect,
    LocalTsqltEffectError,
} from "../../src/runbookStudio/runtime/localTsqltEffect";

suite("Runbook Studio local tSQLt effect", () => {
    test("records observation before returning and always disconnects", async () => {
        const events: string[] = [];
        const result = await executeLocalTsqltEffect({
            connect: async () => {
                events.push("connect");
                return true;
            },
            execute: async () => {
                events.push("execute");
                return { rowCount: 2 };
            },
            recordObserved: () => events.push("observed"),
            recordNoEffectFailure: () => events.push("no-effect"),
            disconnect: async () => {
                events.push("disconnect");
            },
        });

        expect(result).to.deep.equal({ rowCount: 2 });
        expect(events).to.deep.equal(["connect", "execute", "observed", "disconnect"]);
    });

    test("proves no effect when connection is refused", async () => {
        const events: string[] = [];
        let error: unknown;
        try {
            await executeLocalTsqltEffect({
                connect: async () => false,
                execute: async () => "unused",
                recordObserved: () => events.push("observed"),
                recordNoEffectFailure: () => events.push("no-effect"),
                disconnect: async () => {
                    events.push("disconnect");
                },
            });
        } catch (caught) {
            error = caught;
        }

        expect(error).to.be.instanceOf(LocalTsqltEffectError);
        expect((error as LocalTsqltEffectError).reason).to.equal("connectFailed");
        expect(events).to.deep.equal(["no-effect"]);
    });

    test("leaves a started execution outcome unknown and still disconnects", async () => {
        const events: string[] = [];
        let error: unknown;
        try {
            await executeLocalTsqltEffect({
                connect: async () => true,
                execute: async () => {
                    events.push("execute");
                    throw new Error("injected transport failure");
                },
                recordObserved: () => events.push("observed"),
                recordNoEffectFailure: () => events.push("no-effect"),
                disconnect: async () => {
                    events.push("disconnect");
                    throw new Error("injected disconnect failure");
                },
            });
        } catch (caught) {
            error = caught;
        }

        expect(error).to.be.instanceOf(LocalTsqltEffectError);
        expect((error as LocalTsqltEffectError).reason).to.equal("executionFailed");
        expect(events).to.deep.equal(["execute", "disconnect"]);
    });
});
