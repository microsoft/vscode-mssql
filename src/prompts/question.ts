
'use strict';

export class QuestionTypes {
    public static get input(): string { return 'input'; }
    public static get password(): string { return 'password'; }
    public static get list(): string { return 'list'; }
    public static get confirm(): string { return 'confirm'; }
    public static get checkbox(): string { return 'checkbox'; }
    public static get expand(): string { return 'expand'; }
}

// Question interface to clarify how to use the prompt feature
// based on Bower Question format: https://github.com/bower/bower/blob/89069784bb46bfd6639b4a75e98a0d7399a8c2cb/packages/bower-logger/README.md
export interface IQuestion {
    // Type of question (see QuestionTypes)
    type: string;
    // Name of the question for disambiguation
    name: string;
    // Message to display to the user
    message: string;
    // Optional placeHolder to give more detailed information to the user
    placeHolder?: any;
    // Optional default value - this will be used instead of placeHolder
    default?: any;
    // optional set of choices to be used. Must be a simple type or for objects, have a .name property for display
    choices?: any[];
    // Optional validation function that returns an error string if validation fails
    validate?: (value: any) => string;
    // Optional pre-prompt function. Takes in set of answers so far, and returns true if prompt should occur
    shouldPrompt?: (answers: {[id: string]: any}) => boolean;
    // Optional action to take on the question being answered
    onAnswered?: (value: any) => void;
}

// Generic object that can be used to define a set of questions and handle the result
export interface IQuestionHandler {
    // Set of questions to be answered
    questions: IQuestion[];
    // Optional callback, since questions may handle themselves
    callback?: IPromptCallback;
}

export interface IPrompter {
    prompt(questions: IQuestion[], callback: IPromptCallback): void;
}

export interface IPromptCallback {
    (answers: {[id: string]: any}): void;
}
