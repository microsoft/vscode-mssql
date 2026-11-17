/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-jsonrpc";
import { CoreRPCs } from "./webview";

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

export type Question = NpsQuestion | NsatQuestion | TextareaQuestion | JobRoleQuestion | Divider;

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

/** A built-in job role question with an optional free-text answer for Other. */
export interface JobRoleQuestion extends Pick<BaseQuestion, "id" | "required"> {
    type: "jobRole";
    /** Answer key for the specification accompanying an Other selection. */
    otherAnswerId: string;
}

export interface Divider {
    type: "divider";
}

export interface UserSurveyContextProps extends CoreRPCs {
    submit(answers: Answers): void;
    cancel(): void;
    openPrivacyStatement(): void;
    getFeatureHints(answers: Answers, source: FeatureHintSource): Promise<FeatureHintResult>;
    isCopilotFeatureHintAvailable(): Promise<boolean>;
    openFeatureHintDocs(hintId: string, source: FeatureHintSource): void;
    tryFeatureHint(hintId: string, source: FeatureHintSource): void;
    closeFeatureHints(
        hintIds: string[],
        source: FeatureHintSource,
        outcome: FeatureHintCloseOutcome,
    ): void;
}

export interface UserSurveyReducers {
    submit: {
        answers: Answers;
    };
    cancel: {};
    openPrivacyStatement: {};
    openFeatureHintDocs: {
        hintId: string;
        source: FeatureHintSource;
    };
    tryFeatureHint: {
        hintId: string;
        source: FeatureHintSource;
    };
    closeFeatureHints: {
        hintIds: string[];
        source: FeatureHintSource;
        outcome: FeatureHintCloseOutcome;
    };
}

export type Answers = Record<string, string | number>;

/**
 * Feature hints are only offered when the recommendation score is at or below this value.
 */
export const FEATURE_HINT_MAX_SCORE = 8;

/** How a feature hint was found: local keyword matching, or Copilot. */
export type FeatureHintSource = "keyword" | "copilot";

export type FeatureHintCloseOutcome = "cancel" | "submitAnyway";

/** Display-only view of a configured feature hint; links stay on the extension side. */
export interface FeatureHintSuggestion {
    id: string;
    featureName: string;
    description: string;
    hasDocs: boolean;
    canTryNow: boolean;
    /** Overrides the default "Try it now" button text. */
    tryNowLabel?: string;
}

export type FeatureHintStatus = "ok" | "notEligible" | "unavailable" | "error";

export interface FeatureHintResult {
    status: FeatureHintStatus;
    suggestions: FeatureHintSuggestion[];
}

export namespace GetFeatureHintsRequest {
    export const type = new RequestType<
        { answers: Answers; source: FeatureHintSource },
        FeatureHintResult,
        void
    >("userSurvey/getFeatureHints");
}

export namespace IsCopilotFeatureHintAvailableRequest {
    export const type = new RequestType<void, boolean, void>(
        "userSurvey/isCopilotFeatureHintAvailable",
    );
}

export interface FeatureHintInput {
    score?: number;
    feedback: string;
}

/** Reads the recommendation score and free-form feedback out of a survey's answers. */
export function getFeatureHintInput(questions: Question[], answers: Answers): FeatureHintInput {
    const npsQuestion = questions.find((question) => question.type === "nps") as
        | NpsQuestion
        | undefined;
    const score = npsQuestion ? answers[npsQuestion.id] : undefined;
    const feedback = questions
        .filter((question): question is TextareaQuestion => question.type === "textarea")
        .map((question) => answers[question.id])
        .filter((answer): answer is string => typeof answer === "string")
        .join("\n")
        .trim();

    return { score: typeof score === "number" ? score : undefined, feedback };
}

export function isFeatureHintEligible(input: FeatureHintInput): boolean {
    return (
        input.score !== undefined && input.score <= FEATURE_HINT_MAX_SCORE && input.feedback !== ""
    );
}
