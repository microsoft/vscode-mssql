// This code is originally from https://github.com/DonJayamanne/bowerVSCode
// License: https://github.com/DonJayamanne/bowerVSCode/blob/master/LICENSE

import { InputBoxOptions, QuickPickOptions } from "vscode";
import VscodeWrapper from "../controllers/vscodeWrapper";

abstract class Prompt {
  protected _question: any;
  protected _ignoreFocusOut?: boolean;
  protected _vscodeWrapper: VscodeWrapper;

  constructor(
    question: any,
    vscodeWrapper: VscodeWrapper,
    ignoreFocusOut?: boolean,
  ) {
    this._question = question;
    this._ignoreFocusOut = ignoreFocusOut ? ignoreFocusOut : false;
    this._vscodeWrapper = vscodeWrapper;
  }

  public abstract render(): any;

  protected get defaultQuickPickOptions(): QuickPickOptions {
    return {
      ignoreFocusOut: this._ignoreFocusOut,
    };
  }

  protected get defaultInputBoxOptions(): InputBoxOptions {
    return {
      ignoreFocusOut: this._ignoreFocusOut,
    };
  }
}

export default Prompt;
