/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as chai from "chai";
import PromptFactory from "../../src/prompts/factory";
import InputPrompt from "../../src/prompts/input";
import PasswordPrompt from "../../src/prompts/password";
import ListPrompt from "../../src/prompts/list";
import ConfirmPrompt from "../../src/prompts/confirm";
import CheckboxPrompt from "../../src/prompts/checkbox";
import ExpandPrompt from "../../src/prompts/expand";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";

chai.use(sinonChai);

suite("Prompts test", () => {
    let sandbox: sinon.SinonSandbox;
    let vscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;

    setup(() => {
        sandbox = sinon.createSandbox();
        vscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("Test string prompt", () => {
        const question: any = {
            type: "string",
        };
        const prompt = PromptFactory.createPrompt(question, vscodeWrapper);
        expect(prompt).to.be.instanceOf(InputPrompt);
    });

    test("Test input prompt", () => {
        const question: any = {
            type: "input",
            default: Error("test"),
            placeHolder: "test_placeHolder",
        };
        const prompt = PromptFactory.createPrompt(question, vscodeWrapper);
        expect(prompt).to.be.instanceOf(InputPrompt);
        expect(question.type).to.equal(InputPrompt.promptType);
    });

    test("Test password prompt", () => {
        const question: any = {
            type: "password",
        };
        const prompt = PromptFactory.createPrompt(question, vscodeWrapper);
        expect(prompt).to.be.instanceOf(PasswordPrompt);
    });

    test("Test list prompt", () => {
        const question: any = {
            type: "list",
        };
        const prompt = PromptFactory.createPrompt(question, vscodeWrapper);
        expect(prompt).to.be.instanceOf(ListPrompt);
    });

    test("Test confirm prompt", () => {
        const question: any = {
            type: "confirm",
        };
        const prompt = PromptFactory.createPrompt(question, vscodeWrapper);
        expect(prompt).to.be.instanceOf(ConfirmPrompt);
    });

    test("Test checkbox prompt", () => {
        const question: any = {
            type: "checkbox",
        };
        const prompt = PromptFactory.createPrompt(question, vscodeWrapper);
        expect(prompt).to.be.instanceOf(CheckboxPrompt);
    });

    test("Test expand prompt", () => {
        const question: any = {
            type: "expand",
        };
        const prompt = PromptFactory.createPrompt(question, vscodeWrapper);
        expect(prompt).to.be.instanceOf(ExpandPrompt);
    });

    test("Test bogus prompt", () => {
        const question: any = {
            type: "fail",
        };
        expect(() => PromptFactory.createPrompt(question, vscodeWrapper)).to.throw();
    });
});
