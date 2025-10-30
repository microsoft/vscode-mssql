/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as constants from "../constants/constants";
import * as Loc from "../constants/locConstants";
import * as vscode from "vscode";
import * as os from "os";

import { Answers, UserSurveyReducers, UserSurveyState } from "../sharedInterfaces/userSurvey";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";

import { ReactWebviewPanelController } from "../controllers/reactWebviewPanelController";
import { sendActionEvent } from "../telemetry/telemetry";
import VscodeWrapper from "../controllers/vscodeWrapper";

const PROBABILITY = 0.15;
export const SESSION_COUNT_KEY = "nps/sessionCount";
export const LAST_SESSION_DATE_KEY = "nps/lastSessionDate";
export const SKIP_VERSION_KEY = "nps/skipVersion";
export const IS_CANDIDATE_KEY = "nps/isCandidate";
export const NEVER_KEY = "nps/never";

export enum FunnelSteps {
    EnterFunnel = "enterFunnel",
    EligibilityCheck = "eligibilityCheck",
    Prompt = "prompt",
    Survey = "survey",
}

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

    /**
     * Checks user eligibility for NPS survey and, if eligible, displays the survey and submits feedback.
     * Does not block the calling function or throw errors.
     **/
    public promptUserForNPSFeedback(source: string): void {
        void this.promptUserForNPSFeedbackAsync(source).catch((err) => {
            // Handle any errors that occur during the prompt and not throwing them in order to not break the calling function
            console.error("Error prompting for NPS feedback:", err);
        });
    }

    /**
     * Launch the survey directly and submit feedback; do not check for survey eligibility first
     */
    public launchSurvey(surveyId: string, survey: UserSurveyState, source?: string): void {
        void this.launchSurveyAsync(surveyId, survey, source).catch((err) => {
            console.error("Error launching survey:", err);
        });
    }

    private async promptUserForNPSFeedbackAsync(source?: string): Promise<void> {
        const globalState = this._context.globalState;
        const sessionCount = globalState.get(SESSION_COUNT_KEY, 0) + 1;
        const extensionVersion =
            vscode.extensions.getExtension(constants.extensionId).packageJSON.version || "unknown";

        sendActionEvent(TelemetryViews.UserSurvey, TelemetryActions.SurveyFunnel, {
            step: FunnelSteps.EnterFunnel,
            source: source,
        });

        if (!(await this.shouldPromptForFeedback(source))) {
            return;
        }

        const selection = await vscode.window.showInformationMessage(
            Loc.UserSurvey.doYouMindTakingAQuickFeedbackSurvey,
            Loc.UserSurvey.takeSurvey,
            Loc.Common.remindMeLater,
            Loc.Common.dontShowAgain,
        );

        switch (selection) {
            case Loc.UserSurvey.takeSurvey: {
                sendActionEvent(TelemetryViews.UserSurvey, TelemetryActions.SurveyFunnel, {
                    step: FunnelSteps.Prompt,
                    outcome: "takeSurvey",
                    source: source,
                });

                const state: UserSurveyState = getStandardNPSQuestions();
                await this.launchSurveyAsync("nps", state, source);

                await globalState.update(IS_CANDIDATE_KEY, false);
                await globalState.update(SKIP_VERSION_KEY, extensionVersion);
                break;
            }
            case Loc.Common.dontShowAgain: {
                sendActionEvent(TelemetryViews.UserSurvey, TelemetryActions.SurveyFunnel, {
                    step: FunnelSteps.Prompt,
                    outcome: "dontShowAgain",
                    source: source,
                });

                await globalState.update(NEVER_KEY, true);
                break;
            }
            // If the user closed the prompt without making a selection, treat it as "remind me later"
            case Loc.Common.remindMeLater:
            default: {
                sendActionEvent(TelemetryViews.UserSurvey, TelemetryActions.SurveyFunnel, {
                    step: FunnelSteps.Prompt,
                    outcome: selection ? "remindMeLater" : "closedPrompt",
                    source: source,
                });

                await globalState.update(SESSION_COUNT_KEY, sessionCount - 3);
                break;
            }
        }
    }

    private async launchSurveyAsync(
        surveyId: string,
        survey: UserSurveyState,
        source?: string,
    ): Promise<Answers> {
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
                sendActionEvent(TelemetryViews.UserSurvey, TelemetryActions.SurveyFunnel, {
                    step: FunnelSteps.Survey,
                    outcome: "submitted",
                    source: source,
                });
                resolve(e);
            });

            this._webviewController.onCancel(() => {
                sendActionEvent(TelemetryViews.UserSurvey, TelemetryActions.SurveyFunnel, {
                    step: FunnelSteps.Survey,
                    outcome: "cancelled",
                    source: source,
                });
                resolve({});
            });
        });

        sendSurveyTelemetry(surveyId, answers, source);
        return answers;
    }

    private async shouldPromptForFeedback(source: string | undefined): Promise<boolean> {
        const globalState = this._context.globalState;

        // 1. Don't prompt if the user has opted out of the survey completely
        const isNeverUser = globalState.get(NEVER_KEY, false);
        if (isNeverUser) {
            sendActionEvent(TelemetryViews.UserSurvey, TelemetryActions.SurveyFunnel, {
                step: FunnelSteps.EligibilityCheck,
                outcome: "exit_optedOut",
                source: source,
            });
            return false;
        }

        // 2. Don't prompt again if the user has already been prompted for feedback in this version
        const extensionVersion =
            vscode.extensions.getExtension(constants.extensionId).packageJSON.version || "unknown";
        const skipVersion = globalState.get(SKIP_VERSION_KEY, "");
        if (skipVersion === extensionVersion) {
            sendActionEvent(TelemetryViews.UserSurvey, TelemetryActions.SurveyFunnel, {
                step: FunnelSteps.EligibilityCheck,
                outcome: "exit_skipVersion",
                source: source,
            });
            return false;
        }

        // 3. Don't prompt if the user has already been considered for the survey today
        const date = new Date().toDateString();
        const lastSessionDate = globalState.get(LAST_SESSION_DATE_KEY, new Date(0).toDateString());

        if (date === lastSessionDate) {
            sendActionEvent(TelemetryViews.UserSurvey, TelemetryActions.SurveyFunnel, {
                step: FunnelSteps.EligibilityCheck,
                outcome: "exit_alreadyConsidered",
                source: source,
            });
            return false;
        }

        const sessionCount = globalState.get(SESSION_COUNT_KEY, 0) + 1;
        await globalState.update(LAST_SESSION_DATE_KEY, date);
        await globalState.update(SESSION_COUNT_KEY, sessionCount);

        // 4. Don't prompt if the user hasn't used the extension much
        if (sessionCount < 5) {
            sendActionEvent(TelemetryViews.UserSurvey, TelemetryActions.SurveyFunnel, {
                step: FunnelSteps.EligibilityCheck,
                outcome: "exit_notEnoughSessions",
                source: source,
            });
            return false;
        }

        // 5. Of the remaining users, randomly select a subset to prompt to ensure we get feedback from a variety of users over time
        const isCandidate = globalState.get(IS_CANDIDATE_KEY, false) || Math.random() < PROBABILITY;
        await globalState.update(IS_CANDIDATE_KEY, isCandidate);

        if (!isCandidate) {
            await globalState.update(SKIP_VERSION_KEY, extensionVersion);
            sendActionEvent(TelemetryViews.UserSurvey, TelemetryActions.SurveyFunnel, {
                step: FunnelSteps.EligibilityCheck,
                outcome: "exit_notSelectedAsCandidate",
                source: source,
            });
            return false;
        }

        sendActionEvent(TelemetryViews.UserSurvey, TelemetryActions.SurveyFunnel, {
            step: FunnelSteps.EligibilityCheck,
            outcome: "prompt",
            source: source,
        });
        return true;
    }
}

export function sendSurveyTelemetry(surveyId: string, answers: Answers, source?: string): void {
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
            source: source,
            ...stringAnswers,
        },
        numericalAnswers,
    );
}

export class UserSurveyWebviewController extends ReactWebviewPanelController<
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
            title: Loc.UserSurvey.mssqlFeedback,
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
                    Loc.UserSurvey.fileAnIssuePrompt,
                    Loc.UserSurvey.submitIssue,
                    Loc.Common.cancel,
                );

                sendActionEvent(TelemetryViews.UserSurvey, TelemetryActions.SubmitGithubIssue, {
                    response:
                        response === Loc.UserSurvey.submitIssue ? "submitted" : "not submitted",
                });

                if (response === Loc.UserSurvey.submitIssue) {
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
                    ? Loc.UserSurvey.howLikelyAreYouToRecommendFeature(featureName)
                    : Loc.UserSurvey.howlikelyAreYouToRecommendMSSQLExtension,
                type: "nps",
                required: true,
            },
            {
                id: "nsat",
                label: featureName
                    ? Loc.UserSurvey.overallHowStatisfiedAreYouWithFeature(featureName)
                    : Loc.UserSurvey.overallHowSatisfiedAreYouWithMSSQLExtension,
                type: "nsat",
                required: true,
            },
            {
                type: "divider",
            },
            {
                id: "comments",
                label: Loc.UserSurvey.whatCanWeDoToImprove,
                type: "textarea",
                required: false,
                placeholder: Loc.UserSurvey.privacyDisclaimer,
            },
        ],
    };
}
