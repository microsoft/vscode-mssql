/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import CodeAdapter from "../../src/prompts/adapter";
import { IQuestion } from "../../src/prompts/question";
import { createStubLogger, stubMessageBoxes } from "./utils";
import * as Logger from "../../src/models/logger";

chai.use(sinonChai);

suite("Code Adapter Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let adapter: CodeAdapter;
    let messageBoxes: ReturnType<typeof stubMessageBoxes>;
    let loggerStub: ReturnType<typeof createStubLogger>;

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
        loggerStub = createStubLogger(sandbox);
        sandbox.stub(Logger, "getLogger").returns(loggerStub);
        messageBoxes = stubMessageBoxes(sandbox);

        messageBoxes.showErrorMessage.resolves(undefined);

        adapter = new CodeAdapter();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("logError should write to logger", () => {
        adapter.logError(testMessage);
        expect(loggerStub.error).to.have.been.calledOnce;
    });

    test("log should format message and write to logger", () => {
        adapter.log(testMessage);
        expect(loggerStub.info).to.have.been.calledOnce;
    });

    test("showLog should show the logger", () => {
        adapter.showLog();
        expect(loggerStub.show).to.have.been.calledOnce;
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            choices: ["test" as any], // Intentionally wrong type to trigger fixQuestion
        };
        await adapter.promptSingle(question);
    });
});
