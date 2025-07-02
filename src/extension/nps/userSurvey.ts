/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as constants from "../constants/constants";
import * as locConstants from "../constants/locConstants";
import * as vscode from "vscode";
import * as os from "os";

import { Answers, UserSurveyReducers, UserSurveyState } from "../sharedInterfaces/userSurvey";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";

import { ReactWebviewPanelController } from "../controllers/reactWebviewPanelController";
import { sendActionEvent } from "../telemetry/telemetry";
import VscodeWrapper from "../controllers/vscodeWrapper";

const PROBABILITY = 0.15;
const SESSION_COUNT_KEY = "nps/sessionCount";
const LAST_SESSION_DATE_KEY = "nps/lastSessionDate";
const SKIP_VERSION_KEY = "nps/skipVersion";
const IS_CANDIDATE_KEY = "nps/isCandidate";
const NEVER_KEY = "nps/never";

export class UserSurvey {
    private static _instance: UserSurvey;
    private _webviewController: UserSurveyWebviewController;
    private constructor(
        private _context: vscode.ExtensionContext,
        private vscodeWrapper: VscodeWrapper,
    ) {}
    public static createInstance(
        _context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
    ): void {
        UserSurvey._instance = new UserSurvey(_context, vscodeWrapper);
    }
    public static getInstance(): UserSurvey {
        return UserSurvey._instance;
    }

    /** checks user eligibility for NPS survey and, if eligible, displays the survey and submits feedback */
    public promptUserForNPSFeedback(): void {
        void this.promptUserForNPSFeedbackAsync().catch((err) => {
            // Handle any errors that occur during the prompt and not throwing them in order to not break the calling function
            console.error("Error prompting for NPS feedback:", err);
        });
    }

    private async promptUserForNPSFeedbackAsync(): Promise<void> {
        const globalState = this._context.globalState;
        const sessionCount = globalState.get(SESSION_COUNT_KEY, 0) + 1;
        const extensionVersion =
            vscode.extensions.getExtension(constants.extensionId).packageJSON.version || "unknown";

        if (!(await this.shouldPromptForFeedback())) {
            return;
        }

        const take = {
            title: locConstants.UserSurvey.takeSurvey,
            run: async () => {
                const state: UserSurveyState = getStandardNPSQuestions();
                await this.launchSurvey("nps", state);

                await globalState.update(IS_CANDIDATE_KEY, false);
                await globalState.update(SKIP_VERSION_KEY, extensionVersion);
            },
        };
        const remind = {
            title: locConstants.Common.remindMeLater,
            run: async () => {
                await globalState.update(SESSION_COUNT_KEY, sessionCount - 3);
            },
        };
        const never = {
            title: locConstants.Common.dontShowAgain,
            isSecondary: true,
            run: async () => {
                await globalState.update(NEVER_KEY, true);
            },
        };

        const button = await vscode.window.showInformationMessage(
            locConstants.UserSurvey.doYouMindTakingAQuickFeedbackSurvey,
            take,
            remind,
            never,
        );
        await (button || remind).run();
    }

    /** launches the survey directly and submits feedback; does not check for survey eligibility first */
    public async launchSurvey(surveyId: string, survey: UserSurveyState): Promise<Answers> {
        const state: UserSurveyState = survey;
        if (!this._webviewController || this._webviewController.isDisposed) {
            this._webviewController = new UserSurveyWebviewController(
                this._context,
                this.vscodeWrapper,
                state,
            );
        } else {
            this._webviewController.updateState(state);
        }
        this._webviewController.revealToForeground();

        const answers = await new Promise<Answers>((resolve) => {
            this._webviewController.onSubmit((e) => {
                resolve(e);
            });

            this._webviewController.onCancel(() => {
                resolve({});
            });
        });

        sendSurveyTelemetry(surveyId, answers);
        return answers;
    }

    private async shouldPromptForFeedback(): Promise<boolean> {
        const globalState = this._context.globalState;

        // If the user has opted out of the survey, don't prompt for feedback
        const isNeverUser = globalState.get(NEVER_KEY, false);
        if (isNeverUser) {
            return false;
        }

        // If the user has already been prompted for feedback in this version, don't prompt again
        const extensionVersion =
            vscode.extensions.getExtension(constants.extensionId).packageJSON.version || "unknown";
        const skipVersion = globalState.get(SKIP_VERSION_KEY, "");
        if (skipVersion === extensionVersion) {
            return false;
        }

        const date = new Date().toDateString();
        const lastSessionDate = globalState.get(LAST_SESSION_DATE_KEY, new Date(0).toDateString());

        if (date === lastSessionDate) {
            return false;
        }

        const sessionCount = globalState.get(SESSION_COUNT_KEY, 0) + 1;
        await globalState.update(LAST_SESSION_DATE_KEY, date);
        await globalState.update(SESSION_COUNT_KEY, sessionCount);

        // don't prompt for feedback from users until they've had a chance to use the extension a few times
        if (sessionCount < 5) {
            return false;
        }

        const isCandidate = globalState.get(IS_CANDIDATE_KEY, false) || Math.random() < PROBABILITY;

        await globalState.update(IS_CANDIDATE_KEY, isCandidate);

        if (!isCandidate) {
            await globalState.update(SKIP_VERSION_KEY, extensionVersion);
            return false;
        }

        return true;
    }
}

export function sendSurveyTelemetry(surveyId: string, answers: Answers): void {
    // Separate string answers from number answers
    const stringAnswers = Object.keys(answers).reduce((acc, key) => {
        if (typeof answers[key] === "string") {
            acc[key] = answers[key];
        }
        return acc;
    }, {});
    const numericalAnswers = Object.keys(answers).reduce((acc, key) => {
        if (typeof answers[key] === "number") {
            acc[key] = answers[key];
        }
        return acc;
    }, {});

    sendActionEvent(
        TelemetryViews.UserSurvey,
        TelemetryActions.SurveySubmit,
        {
            surveyId: surveyId,
            modernFeaturesEnabled: vscode.workspace
                .getConfiguration()
                .get(constants.configEnableRichExperiences),
            useLegacyConnectionExperience: vscode.workspace
                .getConfiguration()
                .get(constants.configUseLegacyConnectionExperience),
            useLegacyQueryResultExperience: vscode.workspace
                .getConfiguration()
                .get(constants.configUseLegacyQueryResultExperience),
            ...stringAnswers,
        },
        numericalAnswers,
    );
}

class UserSurveyWebviewController extends ReactWebviewPanelController<
    UserSurveyState,
    UserSurveyReducers
> {
    private _onSubmit: vscode.EventEmitter<Answers> = new vscode.EventEmitter<
        Record<string, string>
    >();
    public readonly onSubmit: vscode.Event<Answers> = this._onSubmit.event;

    private _onCancel: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onCancel: vscode.Event<void> = this._onCancel.event;

    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        state?: UserSurveyState,
    ) {
        super(context, vscodeWrapper, "userSurvey", "userSurvey", state, {
            title: locConstants.UserSurvey.mssqlFeedback,
            viewColumn: vscode.ViewColumn.Active,
            iconPath: {
                dark: vscode.Uri.joinPath(context.extensionUri, "media", "feedback_dark.svg"),
                light: vscode.Uri.joinPath(context.extensionUri, "media", "feedback_light.svg"),
            },
        });

        this.registerReducer("submit", async (state, payload) => {
            this._onSubmit.fire(payload.answers);

            this.panel.dispose();

            if (
                (payload.answers.nps as number) < 7 /* NPS detractor */ ||
                (payload.answers.nsat as number) < 2 /* NSAT dissatisfied */
            ) {
                const response = await vscode.window.showInformationMessage(
                    locConstants.UserSurvey.fileAnIssuePrompt,
                    locConstants.UserSurvey.submitIssue,
                    locConstants.Common.cancel,
                );

                sendActionEvent(TelemetryViews.UserSurvey, TelemetryActions.SubmitGithubIssue, {
                    response:
                        response === locConstants.UserSurvey.submitIssue
                            ? "submitted"
                            : "not submitted",
                });

                if (response === locConstants.UserSurvey.submitIssue) {
                    const encodedIssueBody = encodeURIComponent(
                        getGithubIssueText(
                            typeof payload.answers.comments === "string"
                                ? payload.answers.comments
                                : "",
                            context.extension.packageJSON.version || "unknown",
                        ),
                    );
                    const issueUrl = `https://github.com/microsoft/vscode-mssql/issues/new?labels=User-filed,Triage:%20Needed&body=${encodedIssueBody}`;
                    vscode.env.openExternal(vscode.Uri.parse(issueUrl));
                }
            }

            return state;
        });

        this.registerReducer("cancel", async (state) => {
            this._onCancel.fire();
            this.panel.dispose();
            return state;
        });

        this.registerReducer("openPrivacyStatement", async (state) => {
            vscode.env.openExternal(vscode.Uri.parse(constants.microsoftPrivacyStatementUrl));
            return state;
        });
        this.panel.onDidDispose(() => {
            this._onCancel.fire();
        });
    }
}

export function getGithubIssueText(comments: string, extensionVersion: string): string {
    return `**Describe issue:**
${comments}

**Steps to Reproduce:**
1.
2.
3.

**Expected Behavior:**


**Actual Behavior:**


----
|Software|Version|
|--|--|
|MSSQL Extension|${extensionVersion}|
|VS Code|${vscode.version}|
|OS|${os.type()} ${os.release()}|`;
}

export function getStandardNPSQuestions(featureName?: string): UserSurveyState {
    return {
        questions: [
            {
                id: "nps",
                label: featureName
                    ? locConstants.UserSurvey.howLikelyAreYouToRecommendFeature(featureName)
                    : locConstants.UserSurvey.howlikelyAreYouToRecommendMSSQLExtension,
                type: "nps",
                required: true,
            },
            {
                id: "nsat",
                label: featureName
                    ? locConstants.UserSurvey.overallHowStatisfiedAreYouWithFeature(featureName)
                    : locConstants.UserSurvey.overallHowSatisfiedAreYouWithMSSQLExtension,
                type: "nsat",
                required: true,
            },
            {
                type: "divider",
            },
            {
                id: "comments",
                label: locConstants.UserSurvey.whatCanWeDoToImprove,
                type: "textarea",
                required: false,
                placeholder: locConstants.UserSurvey.privacyDisclaimer,
            },
        ],
    };
}
