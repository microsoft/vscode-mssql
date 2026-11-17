/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { sendActionEvent } from "extension-toolkit/vscode";
import { getLogger } from "../../models/logger";
import { TelemetryActions, TelemetryViews } from "../../sharedInterfaces/telemetry";
import {
    FeatureHintInput,
    FeatureHintResult,
    FeatureHintSource,
    isFeatureHintEligible,
} from "../../sharedInterfaces/userSurvey";
import { getErrorMessage } from "../../utils/utils";
import { findCopilotMatches, selectCheapCopilotModel } from "./copilotFeatureHints";
import {
    FeatureHintDefinition,
    findKeywordMatches,
    getCandidateHints,
    toFeatureHintSuggestion,
    validateFeatureHintDefinitions,
} from "./featureHints";
import { featureHintDefinitions } from "./featureHints.config";

const logger = getLogger("UserSurvey");

const copilotTimeoutMs = 30_000;

export class FeatureHintService {
    private readonly _definitions: FeatureHintDefinition[];

    constructor(
        definitions: readonly FeatureHintDefinition[] = featureHintDefinitions,
        private readonly _selectModel: () => Promise<
            vscode.LanguageModelChat | undefined
        > = selectCheapCopilotModel,
    ) {
        for (const problem of validateFeatureHintDefinitions(definitions)) {
            logger.error(`Ignoring invalid survey feature hint: ${problem}`);
        }
        const ids = new Set<string>();
        this._definitions = definitions.filter((definition) => {
            const valid =
                validateFeatureHintDefinitions([definition]).length === 0 &&
                !ids.has(definition.id);
            ids.add(definition.id);
            return valid;
        });
    }

    public getDefinition(id: string): FeatureHintDefinition | undefined {
        return this._definitions.find((definition) => definition.id === id);
    }

    /** True when there is something for Copilot to check and the user is signed in to Copilot. */
    public async isCopilotAvailable(): Promise<boolean> {
        if (getCandidateHints(this._definitions, "copilot").length === 0) {
            return false;
        }
        try {
            return (await this._selectModel()) !== undefined;
        } catch (error) {
            logger.error(`Failed to look up Copilot models: ${getErrorMessage(error)}`);
            return false;
        }
    }

    /**
     * Keyword hints always run. Copilot hints run in addition when `source` is "copilot".
     */
    public async findHints(
        input: FeatureHintInput,
        source: FeatureHintSource,
        token?: vscode.CancellationToken,
    ): Promise<FeatureHintResult> {
        if (!isFeatureHintEligible(input)) {
            return { status: "notEligible", suggestions: [] };
        }

        const matches = findKeywordMatches(input.feedback, this._definitions);
        let status: FeatureHintResult["status"] = "ok";
        if (source === "copilot") {
            const copilot = await this.findCopilotMatches(input.feedback, token);
            status = copilot.status;
            matches.push(...copilot.matches.filter((match) => !matches.includes(match)));
        }

        if (matches.length > 0) {
            sendActionEvent(TelemetryViews.UserSurvey, TelemetryActions.SurveyFeatureHint, {
                additionalProps: {
                    step: "shown",
                    source,
                    hintIds: matches.map((match) => match.id).join(","),
                },
            });
        }

        return { status, suggestions: matches.map(toFeatureHintSuggestion) };
    }

    private async findCopilotMatches(
        feedback: string,
        token?: vscode.CancellationToken,
    ): Promise<{ status: FeatureHintResult["status"]; matches: FeatureHintDefinition[] }> {
        const started = Date.now();
        const report = (outcome: string, matchCount: number, modelFamily?: string) =>
            sendActionEvent(TelemetryViews.UserSurvey, TelemetryActions.SurveyFeatureHint, {
                additionalProps: { step: "copilotCheck", outcome, modelFamily },
                additionalMeasurements: { durationMs: Date.now() - started, matchCount },
            });

        const candidates = getCandidateHints(this._definitions, "copilot");
        if (candidates.length === 0) {
            report("noCandidates", 0);
            return { status: "ok", matches: [] };
        }

        let model: vscode.LanguageModelChat | undefined;
        try {
            model = await this._selectModel();
        } catch (error) {
            logger.error(`Failed to look up Copilot models: ${getErrorMessage(error)}`);
        }
        if (!model) {
            report("unavailable", 0);
            return { status: "unavailable", matches: [] };
        }

        const cancellation = new vscode.CancellationTokenSource();
        const forwardCancellation = token?.onCancellationRequested(() => cancellation.cancel());
        const timeout = setTimeout(() => cancellation.cancel(), copilotTimeoutMs);
        try {
            const matches = await findCopilotMatches(
                model,
                feedback,
                candidates,
                cancellation.token,
            );
            report("completed", matches.length, model.family);
            return { status: "ok", matches };
        } catch (error) {
            logger.error(`Copilot feature hint check failed: ${getErrorMessage(error)}`);
            report(
                cancellation.token.isCancellationRequested ? "cancelled" : "error",
                0,
                model.family,
            );
            return { status: "error", matches: [] };
        } finally {
            clearTimeout(timeout);
            forwardCancellation?.dispose();
            cancellation.dispose();
        }
    }
}
