/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { TelemetryViews, TelemetryActions, ActivityStatus } from "../../sharedInterfaces/telemetry";
import { startActivity } from "../../telemetry/telemetry";

export abstract class ToolBase<T> implements vscode.LanguageModelTool<T> {
    toolName: string;

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<T>,
        _token: vscode.CancellationToken,
    ) {
        const telemetryActivity = startActivity(
            TelemetryViews.MssqlCopilot,
            TelemetryActions.CopilotAgentModeToolCall,
            `${options.toolInvocationToken}`,
            {
                toolName: this.toolName,
            },
        );
        try {
            const response = await this.call(options, _token);
            telemetryActivity.end(ActivityStatus.Succeeded);
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(response)]);
        } catch (error) {
            telemetryActivity.endFailed(error);
            // Return a structured error payload for any uncaught exception
            const errorPayload = {
                isError: true,
                message: error instanceof Error ? error.message : String(error),
            };
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(JSON.stringify(errorPayload)),
            ]);
        }
    }

    abstract call(
        options: vscode.LanguageModelToolInvocationOptions<T>,
        _token: vscode.CancellationToken,
    ): Promise<string>;
}
