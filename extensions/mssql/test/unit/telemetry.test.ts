/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as Telemetry from "../../src/telemetry/telemetry";

suite("Telemetry Tests", () => {
    test("captureCallStack should return a string", () => {
        const stack = Telemetry.captureCallStack();
        expect(stack).to.be.a("string");
    });

    test("captureCallStack should not be empty", () => {
        const stack = Telemetry.captureCallStack();
        expect(stack.length).to.be.greaterThan(0);
    });

    test("filterStack should filter out internal functions", () => {
        const stack = `Error
    at captureCallStack (/path/to/file.ts:10:10)
    at sendActionEvent (/path/to/file.ts:20:20)
    at sendErrorEvent (/path/to/file.ts:30:30)
    at startActivity (/path/to/file.ts:40:40)
    at update (/path/to/file.ts:50:50)
    at end (/path/to/file.ts:60:60)
    at endFailed (/path/to/file.ts:70:70)
    at UserFunction (/path/to/user/code.ts:80:80)`;

        const filtered = Telemetry.filterStack(stack);
        expect(filtered).to.equal("UserFunction");
    });
    test("filterStack should limit stack frames to 20", () => {
        const stack = `Error
    at Function1 (/path:1:1)
    at Function2 (/path:2:2)
    at Function3 (/path:3:3)
    at Function4 (/path:4:4)
    at Function5 (/path:5:5)
    at Function6 (/path:6:6)
    at Function7 (/path:7:7)
    at Function8 (/path:8:8)
    at Function9 (/path:9:9)
    at Function10 (/path:10:10)
    at Function11 (/path:11:11)
    at Function12 (/path:12:12)
    at Function13 (/path:13:13)
    at Function14 (/path:14:14)
    at Function15 (/path:15:15)
    at Function16 (/path:16:16)
    at Function17 (/path:17:17)
    at Function18 (/path:18:18)
    at Function19 (/path:19:19)
    at Function20 (/path:20:20)
    at Function21 (/path:21:21)`;

        const filtered = Telemetry.filterStack(stack);
        const frames = filtered.split(" < ");
        expect(frames.length).to.equal(20);
        expect(frames[19]).to.equal("Function20");
    });

    test("filterStack should handle class methods correctly", () => {
        const stack = `Error
    at MyClass.myMethod (/path:1:1)
    at OtherClass.otherMethod (/path:2:2)`;

        const filtered = Telemetry.filterStack(stack);
        expect(filtered).to.equal("MyClass.myMethod < OtherClass.otherMethod");
    });

    test("filterStack should NOT filter out user methods with same name as internal functions", () => {
        // "update" is in SKIP_FUNCTIONS, but "MyClass.update" should be kept
        const stack = `Error
    at MyClass.update (/path:1:1)
    at UserCode.run (/path:2:2)`;

        const filtered = Telemetry.filterStack(stack);
        expect(filtered).to.equal("MyClass.update < UserCode.run");
    });

    test("filterStack should NOT filter out internal functions on Object", () => {
        // "update" is in SKIP_FUNCTIONS, but "Object.update" should NOT be skipped
        // because we can't distinguish it from user code
        const stack = `Error
    at Object.update (/path:1:1)
    at UserCode.run (/path:2:2)`;

        const filtered = Telemetry.filterStack(stack);
        expect(filtered).to.equal("Object.update < UserCode.run");
    });

    test("filterStack should handle async functions correctly", () => {
        const stack = `Error: 
    at ConnectionManager.connect (/path/to/file.ts:10:10)
    at async ObjectExplorerService.createSessionAndExpandNode (/path/to/file.ts:20:20)`;

        const filtered = Telemetry.filterStack(stack);
        expect(filtered).to.equal(
            "ConnectionManager.connect < async ObjectExplorerService.createSessionAndExpandNode",
        );
    });
});
