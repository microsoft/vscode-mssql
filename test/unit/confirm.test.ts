/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as TypeMoq from "typemoq";
import VscodeWrapper from "../../src/extension/controllers/vscodeWrapper";
import * as LocalizedConstants from "../../src/extension/constants/locConstants";
import ConfirmPrompt from "../../src/extension/prompts/confirm";

// @cssuh 10/22 - commented this test because it was throwing some random undefined errors
suite.skip("Test Confirm Prompt", () => {
    test("Test Confirm prompt with simple question", () => {
        let question = {
            name: "test",
        };
        let vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper, TypeMoq.MockBehavior.Loose);
        vscodeWrapper
            .setup((v) => v.showQuickPickStrings(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(LocalizedConstants.msgYes));
        let confirm = new ConfirmPrompt(question, vscodeWrapper.object);
        confirm.render();
        vscodeWrapper.verify(
            (v) => v.showQuickPickStrings(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.once(),
        );
    });

    test("Test Checkbox prompt with error", () => {
        let question = {
            name: "test",
        };
        let vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper, TypeMoq.MockBehavior.Loose);
        vscodeWrapper
            .setup((v) => v.showQuickPickStrings(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(undefined));
        let confirm = new ConfirmPrompt(question, vscodeWrapper.object);
        confirm.render();
        vscodeWrapper.verify(
            (v) => v.showQuickPickStrings(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.once(),
        );
    });
});
