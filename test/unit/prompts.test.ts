/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as TypeMoq from "typemoq";
import PromptFactory from "../../src/extension/prompts/factory";
import { assert } from "chai";
import InputPrompt from "../../src/extension/prompts/input";
import PasswordPrompt from "../../src/extension/prompts/password";
import ListPrompt from "../../src/extension/prompts/list";
import ConfirmPrompt from "../../src/extension/prompts/confirm";
import CheckboxPrompt from "../../src/extension/prompts/checkbox";
import ExpandPrompt from "../../src/extension/prompts/expand";
import VscodeWrapper from "../../src/extension/controllers/vscodeWrapper";

suite("Prompts test", () => {
    let vscodeWrapper: TypeMoq.IMock<VscodeWrapper>;

    setup(() => {
        vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper, TypeMoq.MockBehavior.Loose);
    });

    test("Test string prompt", () => {
        let question: any = {
            type: "string",
        };
        let prompt = PromptFactory.createPrompt(question, vscodeWrapper.object);
        assert.equal(prompt instanceof InputPrompt, true);
    });

    test("Test input prompt", () => {
        let question: any = {
            type: "input",
            default: Error("test"),
            placeHolder: "test_placeHolder",
        };
        let prompt = PromptFactory.createPrompt(question, vscodeWrapper.object);
        assert.equal(prompt instanceof InputPrompt, true);
        assert.equal(question.type, InputPrompt.promptType);
    });

    test("Test password prompt", () => {
        let question: any = {
            type: "password",
        };
        let prompt = PromptFactory.createPrompt(question, vscodeWrapper.object);
        assert.equal(prompt instanceof PasswordPrompt, true);
    });

    test("Test list prompt", () => {
        let question: any = {
            type: "list",
        };
        let prompt = PromptFactory.createPrompt(question, vscodeWrapper.object);
        assert.equal(prompt instanceof ListPrompt, true);
    });

    test("Test confirm prompt", () => {
        let question: any = {
            type: "confirm",
        };
        let prompt = PromptFactory.createPrompt(question, vscodeWrapper.object);
        assert.equal(prompt instanceof ConfirmPrompt, true);
    });

    test("Test checkbox prompt", () => {
        let question: any = {
            type: "checkbox",
        };
        let prompt = PromptFactory.createPrompt(question, vscodeWrapper.object);
        assert.equal(prompt instanceof CheckboxPrompt, true);
    });

    test("Test expand prompt", () => {
        let question: any = {
            type: "expand",
        };
        let prompt = PromptFactory.createPrompt(question, vscodeWrapper.object);
        assert.equal(prompt instanceof ExpandPrompt, true);
    });

    test("Test bogus prompt", () => {
        let question: any = {
            type: "fail",
        };
        assert.Throw(() => PromptFactory.createPrompt(question, vscodeWrapper.object));
    });
});
