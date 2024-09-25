/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as constants from "../constants/constants";
import { ReactWebviewPanelController } from "../controllers/reactWebviewController";

const PROBABILITY = 0.15;
const SESSION_COUNT_KEY = "nps/sessionCount";
const LAST_SESSION_DATE_KEY = "nps/lastSessionDate";
const SKIP_VERSION_KEY = "nps/skipVersion";
const IS_CANDIDATE_KEY = "nps/isCandidate";

export class UserSurvey {
    private static _instance: UserSurvey;
    private constructor(private _context: vscode.ExtensionContext) {}
    public static createInstance(_context: vscode.ExtensionContext): void {
        UserSurvey._instance = new UserSurvey(_context);
    }
    public static getInstance(): UserSurvey {
        return UserSurvey._instance;
    }

    public async launchSurvey(): Promise<void> {
        const globalState = this._context.globalState;
        const skipVersion = globalState.get(SKIP_VERSION_KEY, "");
        if (skipVersion) {
            return;
        }

        const date = new Date().toDateString();
        const lastSessionDate = globalState.get(
            LAST_SESSION_DATE_KEY,
            new Date(0).toDateString(),
        );

        if (date === lastSessionDate) {
            return;
        }

        const sessionCount = globalState.get(SESSION_COUNT_KEY, 0) + 1;
        await globalState.update(LAST_SESSION_DATE_KEY, date);
        await globalState.update(SESSION_COUNT_KEY, sessionCount);

        if (sessionCount < 9) {
            return;
        }

        const isCandidate =
            globalState.get(IS_CANDIDATE_KEY, false) ||
            Math.random() < PROBABILITY;

        await globalState.update(IS_CANDIDATE_KEY, isCandidate);

        const extensionVersion =
            vscode.extensions.getExtension(constants.extensionId).packageJSON
                .version || "unknown";
        if (!isCandidate) {
            await globalState.update(SKIP_VERSION_KEY, extensionVersion);
            return;
        }

        const take = {
            title: vscode.l10n.t("Take Survey"),
            run: async () => {
                const webviewController = new UserSurveyWebviewController(
                    this._context,
                );
                webviewController.revealToForeground();
                await globalState.update(IS_CANDIDATE_KEY, false);
                await globalState.update(SKIP_VERSION_KEY, extensionVersion);
            },
        };
        const remind = {
            title: vscode.l10n.t("Remind Me Later"),
            run: async () => {
                await globalState.update(SESSION_COUNT_KEY, sessionCount - 3);
            },
        };
        const never = {
            title: vscode.l10n.t("Don't Show Again"),
            isSecondary: true,
            run: async () => {
                await globalState.update(IS_CANDIDATE_KEY, false);
                await globalState.update(SKIP_VERSION_KEY, extensionVersion);
            },
        };

        const button = await vscode.window.showInformationMessage(
            vscode.l10n.t(
                "Do you mind taking a quick feedback survey about the MSSQL Extensions for VS Code?",
            ),
            take,
            remind,
            never,
        );
        await (button || remind).run();
    }
}

class UserSurveyWebviewController extends ReactWebviewPanelController<
    any,
    any
> {
    constructor(context: vscode.ExtensionContext) {
        super(context, vscode.l10n.t("User Survey"), "userSurvey", {});
    }
}
