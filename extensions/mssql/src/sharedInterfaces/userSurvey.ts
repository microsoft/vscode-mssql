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
    /** Keyword hints always run; Copilot hints also run when the user is signed in to Copilot. */
    getFeatureHints(answers: Answers, trigger: FeatureHintTrigger): Promise<FeatureHintResult>;
    isCopilotFeatureHintAvailable(): Promise<boolean>;
    openFeatureHintDocs(hintId: string): void;
    tryFeatureHint(hintId: string): void;
    closeFeatureHints(hintIds: string[], outcome: FeatureHintCloseOutcome): void;
}

export interface UserSurveyReducers {
    submit: {
        answers: Answers;
    };
    cancel: {};
    openPrivacyStatement: {};
    openFeatureHintDocs: {
        hintId: string;
    };
    tryFeatureHint: {
        hintId: string;
    };
    closeFeatureHints: {
        hintIds: string[];
        outcome: FeatureHintCloseOutcome;
    };
}

export type Answers = Record<string, string | number>;

/**
 * Feature hints are only offered when the recommendation score is at or below this value.
 */
export const FEATURE_HINT_MAX_SCORE = 8;

/** No more than this many features are ever suggested at once. */
export const MAX_FEATURE_HINTS = 2;

export type FeatureHintCloseOutcome = "cancel" | "submitAnyway";

/** What started the check: Submit, or the dedicated Copilot button. */
export type FeatureHintTrigger = "submit" | "copilotButton";

/**
 * Screenshots are bundled into the webview, so config entries refer to them by id. Each id maps
 * to an image in src/webviews/pages/UserSurvey/featureHintScreenshots.ts.
 */
export type FeatureHintScreenshotId =
    | "dataTierApplication"
    | "editData"
    | "localContainer"
    | "schemaCompare"
    | "schemaDesigner"
    | "tableDesigner";

/** Display-only view of a configured feature hint; links stay on the extension side. */
export interface FeatureHintSuggestion {
    id: string;
    featureName: string;
    description: string;
    hasDocs: boolean;
    canTryNow: boolean;
    /** Overrides the default "Try it now" button text. */
    tryNowLabel?: string;
    screenshot?: FeatureHintScreenshotId;
}

/** "notRun" when no Copilot hint applies; "unavailable" when not signed in to Copilot. */
export type CopilotFeatureHintStatus = "ok" | "notRun" | "unavailable" | "error";

export interface FeatureHintResult {
    suggestions: FeatureHintSuggestion[];
    copilotStatus: CopilotFeatureHintStatus;
}

export namespace GetFeatureHintsRequest {
    export const type = new RequestType<
        { answers: Answers; trigger: FeatureHintTrigger },
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
