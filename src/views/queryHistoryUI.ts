/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import VscodeWrapper from "../controllers/vscodeWrapper";
import { IPrompter, IQuestion, QuestionTypes } from "../prompts/question";
import { QueryHistoryProvider } from '../queryHistory/queryHistoryProvider';
import { QueryHistoryNode } from '../queryHistory/queryHistoryNode';
import * as LocalizedConstants from '../constants/localizedConstants';

export class QueryHistoryUI {

    constructor(
        private _prompter: IPrompter,
        private _vscodeWrapper: VscodeWrapper
    ) {}

    public convertToQuickPickItem(node: vscode.TreeItem): vscode.QuickPickItem {
        let historyNode = node as QueryHistoryNode;
        let quickPickItem: vscode.QuickPickItem = {
            label: QueryHistoryProvider.limitStringSize(historyNode.queryString, true),
            detail: `${historyNode.connectionLabel}, ${historyNode.timeStamp.toLocaleString()}`,
            picked: false
        };
        return quickPickItem;
    }

    public showQueryHistoryCommandPalette(options: vscode.QuickPickItem[]): Promise<any> {
        let question: IQuestion = {
            type: QuestionTypes.expand,
            name: 'question',
            message: LocalizedConstants.msgchooseQueryHistoryListing,
            choices: options
        };
        return this._prompter.promptSingle(question);
    }

}