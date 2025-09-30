/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import CodeAdapter from "../../src/prompts/adapter";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { IQuestion } from "../../src/prompts/question";
import { stubVscodeWrapper } from "./utils";

suite("Code Adapter Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let adapter: CodeAdapter;
    let vscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let outputChannel: {
        append: sinon.SinonStub;
        appendLine: sinon.SinonStub;
        clear: sinon.SinonStub;
        show: sinon.SinonStub;
    };

    const testMessage = {
        message: "test_message",
        code: 123,
        level: "456",
        id: 789,
    };
    const testQuestion: IQuestion = {
        type: "password",
        name: "test_question",
        message: "test_message",
        shouldPrompt: ({}) => false,
    };

    setup(() => {
        sandbox = sinon.createSandbox();
        vscodeWrapper = stubVscodeWrapper(sandbox);

        outputChannel = {
            append: sandbox.stub(),
            appendLine: sandbox.stub(),
            clear: sandbox.stub(),
            show: sandbox.stub(),
        };

        sandbox.stub(vscodeWrapper, "outputChannel").get(() => outputChannel as any);
        vscodeWrapper.showErrorMessage.resolves(undefined);

        adapter = new CodeAdapter(vscodeWrapper as unknown as VscodeWrapper);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("logError should append message to the channel", () => {
        adapter.logError(testMessage);
        sinon.assert.calledOnce(outputChannel.appendLine);
    });

    test("log should format message and append to the channel", () => {
        adapter.log(testMessage);
        sinon.assert.calledOnce(outputChannel.appendLine);
    });

    test("clearLog should clear from output channel", () => {
        adapter.clearLog();
        sinon.assert.calledOnce(outputChannel.clear);
    });

    test("showLog should show the output channel", () => {
        adapter.showLog();
        sinon.assert.calledOnce(outputChannel.show);
    });

    test("promptSingle and promptCallback should call prompt", async () => {
        await adapter.promptSingle(testQuestion);
        adapter.promptCallback([testQuestion], () => true);
        // Error case
        await adapter.prompt([{ type: "test", message: "test", name: "test" }]);
    });

    test("prompting a checkbox question should call fixQuestion", async () => {
        const formattedQuestion: IQuestion = {
            type: "checkbox",
            message: "test",
            name: "test_checkbox",
            choices: [{ name: "test_choice", value: "test_choice" }],
        };
        await adapter.promptSingle(formattedQuestion);
        const question: IQuestion = {
            ...formattedQuestion,
            choices: ["test"],
        };
        await adapter.promptSingle(question);
    });
});
