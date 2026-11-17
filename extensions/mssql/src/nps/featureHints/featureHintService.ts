/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { sendActionEvent } from "extension-toolkit/vscode";
import { getLogger } from "../../models/logger";
import { TelemetryActions, TelemetryViews } from "../../sharedInterfaces/telemetry";
import {
    FeatureHintCloseOutcome,
    FeatureHintInput,
    FeatureHintSuggestion,
    MAX_FEATURE_HINTS,
    isFeatureHintEligible,
} from "../../sharedInterfaces/userSurvey";
import { getErrorMessage } from "../../utils/utils";
import {
    CopilotFeatureHintMatchResult,
    findCopilotMatches,
    selectCheapCopilotModel,
} from "./copilotFeatureHints";
import {
    FeatureHintDefinition,
    findKeywordMatches,
    getCandidateHints,
    toFeatureHintSuggestion,
    validateFeatureHintDefinitions,
} from "./featureHints";
import { featureHintDefinitions } from "./featureHints.config";

const logger = getLogger("UserSurvey");

/** The Copilot check can delay Submit, so give up on it quickly. */
const copilotTimeoutMs = 10_000;

export type FeatureHintAction = "shown" | "docs" | "tryNow" | FeatureHintCloseOutcome;

export class FeatureHintService {
    private readonly _definitions: FeatureHintDefinition[];
    /** Last successful Copilot answer, so submitting again after Cancel doesn't ask twice. */
    private _lastCopilotCheck: { feedback: string; matches: CopilotFeatureHintMatchResult[] };

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

    /**
     * Keyword hints always run. Copilot hints also run when the user is signed in to Copilot.
     * Keyword matches come first; at most MAX_FEATURE_HINTS are returned.
     */
    public async findHints(
        input: FeatureHintInput,
        token?: vscode.CancellationToken,
    ): Promise<FeatureHintSuggestion[]> {
        if (!isFeatureHintEligible(input)) {
            return [];
        }

        const keywordMatches = findKeywordMatches(input.feedback, this._definitions);
        const copilotMatches = await this.checkWithCopilot(input.feedback, token);
        const matches = [
            ...keywordMatches.map((definition) => ({ definition, confidence: undefined })),
            ...copilotMatches,
        ].slice(0, MAX_FEATURE_HINTS);

        for (const { definition, confidence } of matches) {
            this.reportAction("shown", definition.id, {}, { confidence });
        }
        return matches.map(({ definition }) => toFeatureHintSuggestion(definition));
    }

    /** Sends telemetry for one hint, attributed to the match mode that found it. */
    public reportAction(
        step: FeatureHintAction,
        hintId: string,
        extraProps: Record<string, string> = {},
        measurements: Record<string, number | undefined> = {},
    ): void {
        const definition = this.getDefinition(hintId);
        if (!definition) {
            return;
        }
        const additionalMeasurements = Object.fromEntries(
            Object.entries(measurements).filter(([, value]) => value !== undefined),
        ) as Record<string, number>;
        sendActionEvent(TelemetryViews.UserSurvey, TelemetryActions.SurveyFeatureHint, {
            additionalProps: { step, hintId, source: definition.match.mode, ...extraProps },
            ...(Object.keys(additionalMeasurements).length ? { additionalMeasurements } : {}),
        });
    }

    private async checkWithCopilot(
        feedback: string,
        token?: vscode.CancellationToken,
    ): Promise<CopilotFeatureHintMatchResult[]> {
        const candidates = getCandidateHints(this._definitions, "copilot");
        if (candidates.length === 0) {
            return [];
        }
        if (this._lastCopilotCheck?.feedback === feedback) {
            return this._lastCopilotCheck.matches;
        }

        const started = Date.now();
        const report = (outcome: string, matchCount: number, modelFamily?: string) =>
            sendActionEvent(TelemetryViews.UserSurvey, TelemetryActions.SurveyFeatureHint, {
                additionalProps: { step: "copilotCheck", outcome, modelFamily },
                additionalMeasurements: { durationMs: Date.now() - started, matchCount },
            });

        let model: vscode.LanguageModelChat | undefined;
        try {
            model = await this._selectModel();
        } catch (error) {
            logger.error(`Failed to look up Copilot models: ${getErrorMessage(error)}`);
        }
        if (!model) {
            report("notSignedIn", 0);
            return [];
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
            this._lastCopilotCheck = { feedback, matches };
            report("completed", matches.length, model.family);
            return matches;
        } catch (error) {
            logger.error(`Copilot feature hint check failed: ${getErrorMessage(error)}`);
            const outcome = token?.isCancellationRequested
                ? "cancelled"
                : cancellation.token.isCancellationRequested
                  ? "timedOut"
                  : "error";
            report(outcome, 0, model.family);
            return [];
        } finally {
            clearTimeout(timeout);
            forwardCancellation?.dispose();
            cancellation.dispose();
        }
    }
}
