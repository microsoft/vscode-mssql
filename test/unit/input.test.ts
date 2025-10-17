/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as chai from "chai";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import InputPrompt from "../../src/prompts/input";

chai.use(sinonChai);

suite("Input Prompt Tests", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("Test list prompt render simple question", async () => {
        const vscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
        vscodeWrapper.showInputBox.resolves("test");
        const question = {
            message: "test",
            placeHolder: "test",
            choices: [{ name: "test", value: "test" }],
        };
        const listPrompt = new InputPrompt(question, vscodeWrapper as unknown as VscodeWrapper);

        await listPrompt.render();

        expect(vscodeWrapper.showInputBox).to.have.been.calledOnce;
    });

    test.skip("Test prompt an error question should throw", async () => {
        const vscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
        const errorQuestion = {
            default: new Error("test"),
            placeHolder: undefined,
        };
        vscodeWrapper.showInputBox.resolves(undefined);
        const listPrompt = new InputPrompt(
            errorQuestion,
            vscodeWrapper as unknown as VscodeWrapper,
        );

        await listPrompt.render();

        expect(vscodeWrapper.showInputBox).to.have.been.calledOnce;
    });

    test("Test prompt question with default message", async () => {
        const vscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
        const defaultQuestion = {
            default: "test_default",
        };
        vscodeWrapper.showInputBox.resolves("");
        const listPrompt = new InputPrompt(
            defaultQuestion,
            vscodeWrapper as unknown as VscodeWrapper,
        );

        await listPrompt.render();

        expect(vscodeWrapper.showInputBox).to.have.been.calledOnce;
    });

    test("Test prompt question with validation error", async () => {
        const vscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
        vscodeWrapper.showInputBox.onFirstCall().resolves("");
        vscodeWrapper.showInputBox.onSecondCall().resolves("valid");
        let attempts = 0;
        const validationQuestion = {
            default: "test",
            validate: () => {
                attempts += 1;
                return attempts === 1 ? "validation error" : undefined;
            },
        };
        const listPrompt = new InputPrompt(
            validationQuestion,
            vscodeWrapper as unknown as VscodeWrapper,
        );

        await listPrompt.render();

        expect(vscodeWrapper.showInputBox).to.have.been.calledTwice;
    });
});
