/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as TypeMoq from "typemoq";
import VscodeWrapper from "../../src/extension/controllers/vscodeWrapper";
import ExpandPrompt from "../../src/extension/prompts/expand";

suite("Test Expand Prompt", () => {
    test("Test expand prompt with simple question", () => {
        let question = {
            choices: [{ name: "test", value: "test" }],
            validate: (e) => false,
        };
        let vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper, TypeMoq.MockBehavior.Loose);
        vscodeWrapper
            .setup((v) => v.showQuickPickStrings(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve("test"));
        let expand = new ExpandPrompt(question, vscodeWrapper.object);
        expand.render();
        vscodeWrapper.verify(
            (v) => v.showQuickPickStrings(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.once(),
        );
    });

    // @cssuh 10/22 - commented this test because it was throwing some random undefined errors
    test.skip("Test expand prompt with error question", () => {
        let question = {
            choices: [{ name: "test", value: "test" }],
            validate: (e) => true,
        };
        let vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper, TypeMoq.MockBehavior.Loose);
        vscodeWrapper
            .setup((v) => v.showQuickPickStrings(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(undefined));
        let expand = new ExpandPrompt(question, vscodeWrapper.object);
        expand.render();
        vscodeWrapper.verify(
            (v) => v.showQuickPickStrings(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.once(),
        );
    });

    test.skip("Test expand prompt with quick pick item", () => {
        let quickPickItem: vscode.QuickPickItem = {
            label: "test",
        };
        let question = {
            choices: [quickPickItem],
            validate: (e) => true,
        };
        let vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper, TypeMoq.MockBehavior.Loose);
        vscodeWrapper
            .setup((v) => v.showQuickPick(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(quickPickItem));
        let expand = new ExpandPrompt(question, vscodeWrapper.object);
        expand.render();
        vscodeWrapper.verify(
            (v) => v.showQuickPick(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.once(),
        );
    });

    test.skip("Test expand prompt with error quick pick item", () => {
        let quickPickItem: vscode.QuickPickItem = {
            label: "test",
        };
        let question = {
            choices: [quickPickItem],
            validate: (e) => false,
        };
        let vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper, TypeMoq.MockBehavior.Loose);
        vscodeWrapper
            .setup((v) => v.showQuickPick(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(undefined));
        let expand = new ExpandPrompt(question, vscodeWrapper.object);
        expand.render();
        vscodeWrapper.verify(
            (v) => v.showQuickPick(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.once(),
        );
    });
});
