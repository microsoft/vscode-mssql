/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import CodeAdapter from "../../src/prompts/adapter";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { IQuestion } from "../../src/prompts/question";
import { stubVscodeWrapper } from "./utils";

chai.use(sinonChai);

suite("Code Adapter Tests", () => {
  let sandbox: sinon.SinonSandbox;
  let adapter: CodeAdapter;
  let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;

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
    mockVscodeWrapper = stubVscodeWrapper(sandbox);

    mockVscodeWrapper.showErrorMessage.resolves(undefined);

    adapter = new CodeAdapter(mockVscodeWrapper);
  });

  teardown(() => {
    sandbox.restore();
  });

  test("logError should append message to the channel", () => {
    adapter.logError(testMessage);
    expect(mockVscodeWrapper.outputChannel.appendLine).to.have.been.calledOnce;
  });

  test("log should format message and append to the channel", () => {
    adapter.log(testMessage);
    expect(mockVscodeWrapper.outputChannel.appendLine).to.have.been.calledOnce;
  });

  test("clearLog should clear from output channel", () => {
    adapter.clearLog();
    expect(mockVscodeWrapper.outputChannel.clear).to.have.been.calledOnce;
  });

  test("showLog should show the output channel", () => {
    adapter.showLog();
    expect(mockVscodeWrapper.outputChannel.show).to.have.been.calledOnce;
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
