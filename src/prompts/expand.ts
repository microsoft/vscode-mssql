'use strict';

// This code is originally from https://github.com/DonJayamanne/bowerVSCode
// License: https://github.com/DonJayamanne/bowerVSCode/blob/master/LICENSE

import vscode = require('vscode');
import Prompt from './prompt';
import EscapeException from '../utils/EscapeException';
import { INameValueChoice } from './question';

export default class ExpandPrompt extends Prompt {

    constructor(question: any) {
        super(question);
    }

    public render(): any {
        // label indicates this is a quickpick item. Otherwise it's a name-value pair
        if (this._question.choices[0].label) {
            return this.renderQuickPick(this._question.choices);
        } else {
            return this.renderNameValueChoice(this._question.choices);
        }
    }

    private renderQuickPick(choices: vscode.QuickPickItem[]): any {
        const options: vscode.QuickPickOptions = {
            placeHolder: this._question.message
        };

        return vscode.window.showQuickPick(choices, options)
            .then(result => {
                if (result === undefined) {
                    throw new EscapeException();
                }

                return result || false;
            });
    }
    private renderNameValueChoice(choices: INameValueChoice[]): any {
        const choiceMap = this._question.choices.reduce((result, choice) => {
            result[choice.name] = choice.value;
            return result;
        }, {});

        const options: vscode.QuickPickOptions = {
            placeHolder: this._question.message
        };

        return vscode.window.showQuickPick(Object.keys(choiceMap), options)
            .then(result => {
                if (result === undefined) {
                    throw new EscapeException();
                }

                // Note: cannot be used with 0 or false responses
                return choiceMap[result] || false;
            });
    }
}
