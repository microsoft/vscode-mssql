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


export enum QueryHistoryAction {
    OpenQueryHistoryAction = 1,
    RunQueryHistoryAction = 2
};

export interface QueryHistoryQuickPickItem extends vscode.QuickPickItem {
    node: QueryHistoryNode;
    action: any;
};

export class QueryHistoryUI {

    constructor(
        private _prompter: IPrompter,
        private _vscodeWrapper: VscodeWrapper
    ) {}

    public convertToQuickPickItem(node: vscode.TreeItem): QueryHistoryQuickPickItem {
        let historyNode = node as QueryHistoryNode;
        let quickPickItem: QueryHistoryQuickPickItem = {
            label: QueryHistoryProvider.limitStringSize(historyNode.queryString, true),
            detail: `${historyNode.connectionLabel}, ${historyNode.timeStamp.toLocaleString()}`,
            node: historyNode,
            action: undefined,
            picked: false
        };
        return quickPickItem;
    }

    private showQueryHistoryActions(node: QueryHistoryNode): Promise<string> {
        let options = [{ label: LocalizedConstants.msgOpenQueryHistoryListing },
            { label: LocalizedConstants.msgRunQueryHistoryListing }];
        let question: IQuestion = {
            type: QuestionTypes.expand,
            name: 'question',
            message: LocalizedConstants.msgChooseQueryHistoryAction,
            choices: options
        };
        return this._prompter.promptSingle(question).then((answer: vscode.QuickPickItem) => {
            if (answer) {
                return answer.label;
            }
        });
    }

    /**
     * Shows the Query History List on the command palette
     */
    public showQueryHistoryCommandPalette(options: vscode.QuickPickItem[]): Promise<QueryHistoryQuickPickItem> {
        let question: IQuestion = {
            type: QuestionTypes.expand,
            name: 'question',
            message: LocalizedConstants.msgChooseQueryHistoryListing,
            choices: options
        };
        return this._prompter.promptSingle(question).then((answer: QueryHistoryQuickPickItem) => {
            if (answer) {
                return this.showQueryHistoryActions(answer.node).then((actionAnswer: string) => {
                    if (actionAnswer === LocalizedConstants.msgOpenQueryHistoryListing) {
                        answer.action = QueryHistoryAction.OpenQueryHistoryAction;
                    } else if ( actionAnswer === LocalizedConstants.msgRunQueryHistoryListing) {
                        answer.action = QueryHistoryAction.RunQueryHistoryAction;
                    }
                    return answer;
                })
            }
        });
    }

}