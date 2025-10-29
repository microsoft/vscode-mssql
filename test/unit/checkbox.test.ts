/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as chai from "chai";
import * as figures from "figures";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import CheckboxPrompt from "../../src/prompts/checkbox";

chai.use(sinonChai);

// @cssuh 10/22 - commented this test because it was throwing some random undefined errors
suite("Test Checkbox prompt", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("Test checkbox prompt with simple question", async () => {
        const question = {
            choices: [
                { name: "test1", checked: true },
                { name: "test2", checked: false },
            ],
        };
        const vscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
        vscodeWrapper.showQuickPickStrings.resolves(figures.tick);

        const checkbox = new CheckboxPrompt(question, vscodeWrapper);
        await checkbox.render();

        expect(vscodeWrapper.showQuickPickStrings).to.have.been.calledOnce;
    });

    test("Test Checkbox prompt with error", async () => {
        const question = {
            choices: [
                { name: "test1", checked: true },
                { name: "test2", checked: false },
            ],
        };
        const vscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
        vscodeWrapper.showQuickPickStrings.resolves(undefined);

        const checkbox = new CheckboxPrompt(question, vscodeWrapper);
        await checkbox.render().catch(() => undefined);

        expect(vscodeWrapper.showQuickPickStrings).to.have.been.calledOnce;
    });

    test("Test Checkbox prompt with checked answer", async () => {
        const question = {
            choices: [
                { name: "test1", checked: true },
                { name: "test2", checked: false },
            ],
        };
        const vscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
        vscodeWrapper.showQuickPickStrings.resolves(figures.tick);

        const checkbox = new CheckboxPrompt(question, vscodeWrapper);
        await checkbox.render();

        expect(vscodeWrapper.showQuickPickStrings).to.have.been.calledOnce;
    });
});
