/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { IExtensionContextService } from "extension-toolkit/vscode";

import { cmdCompareExecutionPlans } from "../constants/constants";
import { ExecutionPlanService } from "../services/executionPlanService";
import { openExecutionPlanComparisonWebview } from "./sharedExecutionPlanUtils";
import SqlDocumentService from "./sqlDocumentService";

/** Registers the command that opens a blank comparison, for the user to add plans to. */
export class ExecutionPlanComparisonContribution implements vscode.Disposable {
    private readonly _command: vscode.Disposable;

    constructor(
        executionPlanService: ExecutionPlanService,
        sqlDocumentService: SqlDocumentService,
        @IExtensionContextService contextService: IExtensionContextService,
    ) {
        this._command = vscode.commands.registerCommand(cmdCompareExecutionPlans, () =>
            openExecutionPlanComparisonWebview(
                contextService.context,
                executionPlanService,
                sqlDocumentService,
            ),
        );
    }

    public dispose(): void {
        this._command.dispose();
    }
}
