/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface UserSurveyState {
    /**
     * The title of the survey. By default, it is "Microsoft would like your feedback".
     */
    title?: string;
    /**
     * The subtitle of the survey. By default, it is empty.
     */
    subtitle?: string;
    /**
     * The text of the submit button. By default, it is "Submit".
     */
    submitButtonText?: string;
    /**
     * The text of the cancel button. By default, it is "Cancel".
     */
    cancelButtonText?: string;
    /**
     * The questions of the survey.
     */
    questions: Question[];
}

export interface Question {
    /**
     * The label of the question.
     */
    label: string;
    /**
     * The type of the question.
     * - "nps": Radio button with 0 to 10 options.
     * - "nsat": Radio button with 'Very Satisfied', 'Satisfied', 'Dissatisfied', 'Very Dissatisfied' options.
     * - "textarea": Textarea.
     */
    type: "nps" | "nsat" | "textarea" | "divider";
    /**
     * The placeholder of the textarea. It is only used when the type is "textarea".
     */
    placeholder?: string;
    /**
     * The required field of the question.
     */
    required?: boolean;
}

export interface Answer {
    label?: string;
    answer?: string;
}

export interface UserSurveyContextProps {
    state: UserSurveyState;
    submit(answers: Answer[]): void;
    cancel(): void;
}

export interface UserSurveyReducers {
    submit: {
        answers: Answer[];
    };
    cancel: {};
}
