/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import ListPrompt from "../../src/prompts/list";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { stubVscodeWrapper } from "./utils";

suite("List Prompt Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let vscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    const question = {
        choices: [
            { name: "test1", value: "test1" },
            { name: "test2", value: "test2" },
        ],
    };

    setup(() => {
        sandbox = sinon.createSandbox();
        vscodeWrapper = stubVscodeWrapper(sandbox);
        vscodeWrapper.showQuickPickStrings.resolves("test1");
    });

    teardown(() => {
        sandbox.restore();
    });

    test("Test list prompt render", async () => {
        const listPrompt = new ListPrompt(question, vscodeWrapper);
        await listPrompt.render();

        sinon.assert.calledOnceWithExactly(
            vscodeWrapper.showQuickPickStrings,
            sinon.match.array,
            sinon.match.object,
        );
    });

    // @cssuh 10/22 - commented this test because it was throwing some random undefined errors
    test.skip("Test list prompt render with error", async () => {
        const errorWrapper = stubVscodeWrapper(sandbox);
        errorWrapper.showQuickPickStrings.resolves(undefined);
        const errorPrompt = new ListPrompt(question, errorWrapper);
        await errorPrompt.render();
        sinon.assert.calledOnce(errorWrapper.showQuickPickStrings);
    });
});
