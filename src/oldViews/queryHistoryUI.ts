/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Utils from "../extension/models/utils";
import { IPrompter, IQuestion, QuestionTypes } from "../extension/prompts/question";
import { QueryHistoryNode } from "../extension/queryHistory/queryHistoryNode";
import * as LocalizedConstants from "../extension/constants/locConstants";

export enum QueryHistoryAction {
    OpenQueryHistoryAction = 1,
    RunQueryHistoryAction = 2,
}

// tslint:disable-next-line: interface-name
export interface QueryHistoryQuickPickItem extends vscode.QuickPickItem {
    node: QueryHistoryNode;
    action: any;
}

export class QueryHistoryUI {
    constructor(private _prompter: IPrompter) {}

    public convertToQuickPickItem(node: vscode.TreeItem): QueryHistoryQuickPickItem {
        let historyNode = node as QueryHistoryNode;
        let quickPickItem: QueryHistoryQuickPickItem = {
            label: Utils.limitStringSize(historyNode.queryString, true).trim(),
            detail: `${historyNode.connectionLabel}, ${historyNode.timeStamp.toLocaleString()}`,
            node: historyNode,
            action: undefined,
            picked: false,
        };
        return quickPickItem;
    }

    private showQueryHistoryActions(node: QueryHistoryNode): Promise<string | undefined> {
        let options = [
            { label: LocalizedConstants.msgOpenQueryHistory },
            { label: LocalizedConstants.msgRunQueryHistory },
        ];
        let question: IQuestion = {
            type: QuestionTypes.expand,
            name: "question",
            message: LocalizedConstants.msgChooseQueryHistoryAction,
            choices: options,
        };
        return this._prompter.promptSingle(question).then((answer: vscode.QuickPickItem) => {
            if (answer) {
                return answer.label;
            }
            return undefined;
        });
    }

    /**
     * Shows the Query History List on the command palette
     */
    public showQueryHistoryCommandPalette(
        options: vscode.QuickPickItem[],
    ): Promise<QueryHistoryQuickPickItem | undefined> {
        let question: IQuestion = {
            type: QuestionTypes.expand,
            name: "question",
            message: LocalizedConstants.msgChooseQueryHistory,
            choices: options,
        };
        return this._prompter.promptSingle(question).then((answer: QueryHistoryQuickPickItem) => {
            if (answer) {
                return this.showQueryHistoryActions(answer.node).then((actionAnswer: string) => {
                    if (actionAnswer === LocalizedConstants.msgOpenQueryHistory) {
                        answer.action = QueryHistoryAction.OpenQueryHistoryAction;
                    } else if (actionAnswer === LocalizedConstants.msgRunQueryHistory) {
                        answer.action = QueryHistoryAction.RunQueryHistoryAction;
                    }
                    return answer;
                });
            }
            return undefined;
        });
    }
}
