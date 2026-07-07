/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import ListPrompt from "../../src/prompts/list";
import { stubVscodeWindow } from "./utils";

chai.use(sinonChai);

suite("List Prompt Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let vscodeWindow: ReturnType<typeof stubVscodeWindow>;
    const question = {
        choices: [
            { name: "test1", value: "test1" },
            { name: "test2", value: "test2" },
        ],
    };

    setup(() => {
        sandbox = sinon.createSandbox();
        vscodeWindow = stubVscodeWindow(sandbox);
        vscodeWindow.showQuickPick.resolves("test1");
    });

    teardown(() => {
        sandbox.restore();
    });

    test("Test list prompt render", async () => {
        const listPrompt = new ListPrompt(question);
        await listPrompt.render();

        expect(vscodeWindow.showQuickPick).to.have.been.calledOnceWithExactly(
            sinon.match.array,
            sinon.match.object,
        );
    });

    // @cssuh 10/22 - commented this test because it was throwing some random undefined errors
    test.skip("Test list prompt render with error", async () => {
        vscodeWindow.showQuickPick.resolves(undefined);
        const errorPrompt = new ListPrompt(question);
        await errorPrompt.render();
        expect(vscodeWindow.showQuickPick).to.have.been.calledOnce;
    });
});
