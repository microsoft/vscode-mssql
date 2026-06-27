/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as chai from "chai";
import * as vscode from "vscode";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import ExpandPrompt from "../../src/prompts/expand";
import { stubVscodeWindow } from "./utils";

chai.use(sinonChai);

suite("Test Expand Prompt", () => {
    let sandbox: sinon.SinonSandbox;
    let vscodeWindow: ReturnType<typeof stubVscodeWindow>;

    setup(() => {
        sandbox = sinon.createSandbox();
        vscodeWindow = stubVscodeWindow(sandbox);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("Test expand prompt with simple question", async () => {
        const question = {
            choices: [{ name: "test", value: "test" }],
            validate: () => false,
        };
        const vscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
        vscodeWindow.showQuickPick.resolves("test");

        const expand = new ExpandPrompt(question, vscodeWrapper);
        await expand.render();

        expect(vscodeWindow.showQuickPick).to.have.been.calledOnce;
    });

    // @cssuh 10/22 - commented this test because it was throwing some random undefined errors
    test.skip("Test expand prompt with error question", async () => {
        const question = {
            choices: [{ name: "test", value: "test" }],
            validate: () => true,
        };
        const vscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
        vscodeWindow.showQuickPick.resolves(undefined);

        const expand = new ExpandPrompt(question, vscodeWrapper);
        await expand.render();

        expect(vscodeWindow.showQuickPick).to.have.been.calledOnce;
    });

    test.skip("Test expand prompt with quick pick item", async () => {
        const quickPickItem: vscode.QuickPickItem = {
            label: "test",
        };
        const question = {
            choices: [quickPickItem],
            validate: () => true,
        };
        const vscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
        vscodeWindow.showQuickPick.resolves(quickPickItem);

        const expand = new ExpandPrompt(question, vscodeWrapper);
        await expand.render();

        expect(vscodeWindow.showQuickPick).to.have.been.calledOnce;
    });

    test.skip("Test expand prompt with error quick pick item", async () => {
        const quickPickItem: vscode.QuickPickItem = {
            label: "test",
        };
        const question = {
            choices: [quickPickItem],
            validate: () => false,
        };
        const vscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
        vscodeWindow.showQuickPick.resolves(undefined);

        const expand = new ExpandPrompt(question, vscodeWrapper);
        await expand.render();

        expect(vscodeWindow.showQuickPick).to.have.been.calledOnce;
    });
});
