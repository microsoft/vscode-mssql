// This code is originally from https://github.com/DonJayamanne/bowerVSCode
// License: https://github.com/DonJayamanne/bowerVSCode/blob/master/LICENSE

import Prompt from "./prompt";
import InputPrompt from "./input";
import PasswordPrompt from "./password";
import ListPrompt from "./list";
import ConfirmPrompt from "./confirm";
import CheckboxPrompt from "./checkbox";
import ExpandPrompt from "./expand";
import VscodeWrapper from "../controllers/vscodeWrapper";

export default class PromptFactory {
    public static createPrompt(
        question: any,
        vscodeWrapper: VscodeWrapper,
        ignoreFocusOut?: boolean,
    ): Prompt {
        /**
         * TODO:
         *   - folder
         */
        switch (question.type || "input") {
            case "string":
            case "input":
                return new InputPrompt(question, vscodeWrapper, ignoreFocusOut);
            case "password":
                return new PasswordPrompt(question, vscodeWrapper, ignoreFocusOut);
            case "list":
                return new ListPrompt(question, vscodeWrapper, ignoreFocusOut);
            case "confirm":
                return new ConfirmPrompt(question, vscodeWrapper, ignoreFocusOut);
            case "checkbox":
                return new CheckboxPrompt(question, vscodeWrapper, ignoreFocusOut);
            case "expand":
                return new ExpandPrompt(question, vscodeWrapper, ignoreFocusOut);
            default:
                throw new Error(`Could not find a prompt for question type ${question.type}`);
        }
    }
}
