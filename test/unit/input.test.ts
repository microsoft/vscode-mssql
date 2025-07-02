/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as TypeMoq from "typemoq";
import VscodeWrapper from "../../src/extension/controllers/vscodeWrapper";
import InputPrompt from "../../src/extension/prompts/input";

suite("Input Prompt Tests", () => {
    setup(() => {
        let vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper, TypeMoq.MockBehavior.Loose);
        vscodeWrapper
            .setup((v) => v.showInputBox(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve("test"));
    });

    test("Test list prompt render simple question", () => {
        let vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper, TypeMoq.MockBehavior.Loose);
        vscodeWrapper
            .setup((v) => v.showInputBox(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve("test"));
        const question = {
            message: "test",
            placeHolder: "test",
            choices: [{ name: "test", value: "test" }],
        };
        let listPrompt = new InputPrompt(question, vscodeWrapper.object);
        listPrompt.render();
        vscodeWrapper.verify((v) => v.showInputBox(TypeMoq.It.isAny()), TypeMoq.Times.once());
    });

    test.skip("Test prompt an error question should throw", () => {
        let vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper, TypeMoq.MockBehavior.Loose);
        const errorQuestion = {
            default: new Error("test"),
            placeHolder: undefined,
        };
        vscodeWrapper
            .setup((v) => v.showInputBox(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(undefined));
        let listPrompt = new InputPrompt(errorQuestion, vscodeWrapper.object);
        listPrompt.render();
        vscodeWrapper.verify((v) => v.showInputBox(TypeMoq.It.isAny()), TypeMoq.Times.once());
    });

    test("Test prompt question with default message", () => {
        let vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper, TypeMoq.MockBehavior.Loose);
        const defaultQuestion = {
            default: "test_default",
        };
        vscodeWrapper
            .setup((v) => v.showInputBox(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(""));
        let listPrompt = new InputPrompt(defaultQuestion, vscodeWrapper.object);
        listPrompt.render();
        vscodeWrapper.verify((v) => v.showInputBox(TypeMoq.It.isAny()), TypeMoq.Times.once());
    });

    test("Test prompt question with validation error", () => {
        let vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper, TypeMoq.MockBehavior.Loose);
        vscodeWrapper
            .setup((v) => v.showInputBox(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(""));
        const validationQuestion = {
            default: "test",
            validate: (e) => false,
        };
        let listPrompt = new InputPrompt(validationQuestion, vscodeWrapper.object);
        listPrompt.render();
        vscodeWrapper.verify((v) => v.showInputBox(TypeMoq.It.isAny()), TypeMoq.Times.once());
    });
});
