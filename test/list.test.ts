/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as TypeMoq from 'typemoq';
import ListPrompt from '../src/prompts/list';
import VscodeWrapper from '../src/controllers/vscodeWrapper';


suite('List Prompt Tests', () => {

    let listPrompt: ListPrompt;
    let vscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
    const question = {
        choices: [{name: 'test', value: 'test'}]
    };

    setup(() => {
        vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper, TypeMoq.MockBehavior.Loose);
        vscodeWrapper.setup(v => v.showQuickPickStrings(TypeMoq.It.isAny(),
            TypeMoq.It.isAny())).returns(() => Promise.resolve('test'));
    });

    test('Test list prompt render', () => {
        listPrompt = new ListPrompt(question, vscodeWrapper.object);
        listPrompt.render();
        vscodeWrapper.verify(v => v.showQuickPickStrings(TypeMoq.It.isAny(),
            TypeMoq.It.isAny()), TypeMoq.Times.once());
    });

})