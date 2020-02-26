/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import * as TypeMoq from 'typemoq';
import CodeAdapter from '../src/prompts/adapter';
import VscodeWrapper from '../src/controllers/vscodeWrapper';
import { IQuestion } from '../src/prompts/question';

suite('Code Adapter Tests', () => {

    let adapter: CodeAdapter;
    let outputChannel: TypeMoq.IMock<vscode.OutputChannel>;
    let vscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
    const testMessage = {
        message: 'test_message',
        code: 123,
        level: '456',
        id: 789
    };
    const testQuestion: IQuestion = {
        type: 'password',
        name: 'test_question',
        message: 'test_message',
        shouldPrompt: ({}) => false
    };

    setup(() => {
        vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper, TypeMoq.MockBehavior.Loose);
        outputChannel = TypeMoq.Mock.ofType<vscode.OutputChannel>();
        outputChannel.setup(o => o.appendLine(TypeMoq.It.isAnyString()));
        outputChannel.setup(o => o.clear());
        outputChannel.setup(o => o.show());
        vscodeWrapper.setup(v => v.outputChannel).returns(() => outputChannel.object);
        vscodeWrapper.setup(v => v.showErrorMessage(TypeMoq.It.isAnyString()));
        adapter = new CodeAdapter(vscodeWrapper.object);
    });

    test('logError should append message to the channel', () => {
        adapter.logError(testMessage);
        outputChannel.verify(o => o.appendLine(TypeMoq.It.isAnyString()), TypeMoq.Times.once());
    });

    test('log should format message and append to the channel', () => {
        adapter.log(testMessage);
        outputChannel.verify(o => o.appendLine(TypeMoq.It.isAnyString()), TypeMoq.Times.once());
    });

    test('clearLog should clear from output channel', () => {
        adapter.clearLog();
        outputChannel.verify(o => o.clear(), TypeMoq.Times.once());
    });

    test('showLog should show the output channel', () => {
        adapter.showLog();
        outputChannel.verify(o => o.show(), TypeMoq.Times.once());
    });

    test('promptSingle and promptCallback should call prompt', () => {
        adapter.promptSingle(testQuestion);
        adapter.promptCallback([testQuestion], () => true);
        // Error case
        adapter.prompt([{ type: 'test', message: 'test', name: 'test'}]);
    });

    test('prompting a checkbox question should call fixQuestion', () => {
        let formattedQuestion: IQuestion = {
            type: 'checkbox',
            message: 'test',
            name: 'test_checkbox',
            choices: [{name: 'test_choice', value: 'test_choice'}]
        };
        adapter.promptSingle(formattedQuestion);
        let question: any = Object.assign({}, formattedQuestion);
        question.choices[0] = 'test';
        adapter.promptSingle(question);
    });
});
