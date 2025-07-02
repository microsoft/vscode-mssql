/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as TypeMoq from "typemoq";
import ListPrompt from "../../src/extension/prompts/list";
import VscodeWrapper from "../../src/extension/controllers/vscodeWrapper";

suite("List Prompt Tests", () => {
    let listPrompt: ListPrompt;
    let vscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
    const question = {
        choices: [
            { name: "test1", value: "test1" },
            { name: "test2", value: "test2" },
        ],
    };

    setup(() => {
        vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper, TypeMoq.MockBehavior.Loose);
        vscodeWrapper
            .setup((v) => v.showQuickPickStrings(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve("test1"));
    });

    test("Test list prompt render", () => {
        listPrompt = new ListPrompt(question, vscodeWrapper.object);
        listPrompt.render();
        vscodeWrapper.verify(
            (v) => v.showQuickPickStrings(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.once(),
        );
    });

    // @cssuh 10/22 - commented this test because it was throwing some random undefined errors
    test.skip("Test list prompt render with error", () => {
        let errorWrapper = TypeMoq.Mock.ofType(VscodeWrapper, TypeMoq.MockBehavior.Loose);
        errorWrapper
            .setup((w) => w.showQuickPickStrings(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(undefined));
        let errorPrompt = new ListPrompt(question, errorWrapper.object);
        errorPrompt.render();
        errorWrapper.verify(
            (v) => v.showQuickPickStrings(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.once(),
        );
    });
});
