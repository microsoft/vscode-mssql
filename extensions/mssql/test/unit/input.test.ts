/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as chai from "chai";
import InputPrompt from "../../src/prompts/input";
import { stubVscodeWindow } from "./utils";

chai.use(sinonChai);

suite("Input Prompt Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let vscodeWindow: ReturnType<typeof stubVscodeWindow>;

    setup(() => {
        sandbox = sinon.createSandbox();
        vscodeWindow = stubVscodeWindow(sandbox);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("Test list prompt render simple question", async () => {
        vscodeWindow.showInputBox.resolves("test");
        const question = {
            message: "test",
            placeHolder: "test",
            choices: [{ name: "test", value: "test" }],
        };
        const listPrompt = new InputPrompt(question);

        await listPrompt.render();

        expect(vscodeWindow.showInputBox).to.have.been.calledOnce;
    });

    test.skip("Test prompt an error question should throw", async () => {
        const errorQuestion = {
            default: new Error("test"),
            placeHolder: undefined,
        };
        vscodeWindow.showInputBox.resolves(undefined);
        const listPrompt = new InputPrompt(errorQuestion);

        await listPrompt.render();

        expect(vscodeWindow.showInputBox).to.have.been.calledOnce;
    });

    test("Test prompt question with default message", async () => {
        const defaultQuestion = {
            default: "test_default",
        };
        vscodeWindow.showInputBox.resolves("");
        const listPrompt = new InputPrompt(defaultQuestion);

        await listPrompt.render();

        expect(vscodeWindow.showInputBox).to.have.been.calledOnce;
    });

    test("Test prompt question with validation error", async () => {
        vscodeWindow.showInputBox.onFirstCall().resolves("");
        vscodeWindow.showInputBox.onSecondCall().resolves("valid");
        let attempts = 0;
        const validationQuestion = {
            default: "test",
            validate: () => {
                attempts += 1;
                return attempts === 1 ? "validation error" : undefined;
            },
        };
        const listPrompt = new InputPrompt(validationQuestion);

        await listPrompt.render();

        expect(vscodeWindow.showInputBox).to.have.been.calledTwice;
    });
});
