/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as chai from "chai";
import * as LocalizedConstants from "../../src/constants/locConstants";
import ConfirmPrompt from "../../src/prompts/confirm";
import { stubVscodeWindow } from "./utils";

chai.use(sinonChai);

suite("Test Confirm Prompt", () => {
    let sandbox: sinon.SinonSandbox;
    let vscodeWindow: ReturnType<typeof stubVscodeWindow>;

    setup(() => {
        sandbox = sinon.createSandbox();
        vscodeWindow = stubVscodeWindow(sandbox);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("Test Confirm prompt with simple question", async () => {
        const question = {
            name: "test",
        };
        vscodeWindow.showQuickPick.resolves(LocalizedConstants.msgYes);

        const confirm = new ConfirmPrompt(question);
        await confirm.render();

        expect(vscodeWindow.showQuickPick).to.have.been.calledOnce;
    });

    test("Test Checkbox prompt with error", async () => {
        const question = {
            name: "test",
        };
        vscodeWindow.showQuickPick.resolves(undefined);

        const confirm = new ConfirmPrompt(question);

        await confirm.render().catch(() => undefined);

        expect(vscodeWindow.showQuickPick).to.have.been.calledOnce;
    });
});
