/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebviewContextProps } from "./webview";

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

export type Question = NpsQuestion | NsatQuestion | TextareaQuestion | Divider;

export interface BaseQuestion {
  /**
   * Unique id of the question to identify in telemetry.
   */
  id: string;
  /**
   * The label of the question.
   */
  label: string;
  /**
   * The required field of the question.
   */
  required?: boolean;
}

/**
 * A question with radio buttons with ratings of 0 through 10.
 */
export interface NpsQuestion extends BaseQuestion {
  type: "nps";
}

/**
 * A question with radio buttons with 'Very Satisfied', 'Satisfied', 'Dissatisfied', 'Very Dissatisfied' options.
 * Submitted as a number 0 through 3.
 */
export interface NsatQuestion extends BaseQuestion {
  type: "nsat";
}

export interface TextareaQuestion extends BaseQuestion {
  type: "textarea";
  /**
   * The placeholder for the textarea.
   */
  placeholder?: string;
}

export interface Divider {
  type: "divider";
}

export interface UserSurveyContextProps
  extends WebviewContextProps<UserSurveyState> {
  submit(answers: Answers): void;
  cancel(): void;
  openPrivacyStatement(): void;
}

export interface UserSurveyReducers {
  submit: {
    answers: Answers;
  };
  cancel: {};
  openPrivacyStatement: {};
}

export type Answers = Record<string, string | number>;
