// This code is originally from https://github.com/DonJayamanne/bowerVSCode
// License: https://github.com/DonJayamanne/bowerVSCode/blob/master/LICENSE

import Prompt from "./prompt";
import EscapeException from "../utils/escapeException";
import VscodeWrapper from "../controllers/vscodeWrapper";

export default class ListPrompt extends Prompt {
    constructor(question: any, vscodeWrapper: VscodeWrapper, ignoreFocusOut?: boolean) {
        super(question, vscodeWrapper, ignoreFocusOut);
    }

    public render(): any {
        const choices = this._question.choices.reduce((result, choice) => {
            result[choice.name || choice] = choice.value || choice;
            return result;
        }, {});

        let options = this.defaultQuickPickOptions;
        options.placeHolder = this._question.message;

        return this._vscodeWrapper
            .showQuickPickStrings(Object.keys(choices), options)
            .then((result) => {
                if (result === undefined) {
                    throw new EscapeException();
                }

                return choices[result];
            });
    }
}
