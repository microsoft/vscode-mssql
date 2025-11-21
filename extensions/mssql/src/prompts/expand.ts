// This code is originally from https://github.com/DonJayamanne/bowerVSCode
// License: https://github.com/DonJayamanne/bowerVSCode/blob/master/LICENSE

import * as vscode from "vscode";
import Prompt from "./prompt";
import EscapeException from "../utils/escapeException";
import { INameValueChoice } from "./question";
import VscodeWrapper from "../controllers/vscodeWrapper";

import * as figures from "figures";

export default class ExpandPrompt extends Prompt {
  constructor(
    question: any,
    vscodeWrapper: VscodeWrapper,
    ignoreFocusOut?: boolean,
  ) {
    super(question, vscodeWrapper, ignoreFocusOut);
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
    let options = this.defaultQuickPickOptions;
    options.placeHolder = this._question.message;

    return this._vscodeWrapper
      .showQuickPick(choices, options)
      .then((result) => {
        if (result === undefined) {
          throw new EscapeException();
        }

        return this.validateAndReturn(result || false);
      });
  }
  private renderNameValueChoice(choices: INameValueChoice[]): any {
    const choiceMap = this._question.choices.reduce((result, choice) => {
      result[choice.name] = choice.value;
      return result;
    }, {});

    let options = this.defaultQuickPickOptions;
    options.placeHolder = this._question.message;

    return this._vscodeWrapper
      .showQuickPickStrings(Object.keys(choiceMap), options)
      .then((result) => {
        if (result === undefined) {
          throw new EscapeException();
        }

        // Note: cannot be used with 0 or false responses
        let returnVal = choiceMap[result] || false;
        return this.validateAndReturn(returnVal);
      });
  }

  private validateAndReturn(value: any): any {
    if (!this.validate(value)) {
      return this.render();
    }
    return value;
  }

  private validate(value: any): boolean {
    const validationError = this._question.validate
      ? this._question.validate(value || "")
      : undefined;

    if (validationError) {
      this._question.message = `${figures.warning} ${validationError}`;
      return false;
    }
    return true;
  }
}
