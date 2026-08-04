/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { InstantiationServiceBuilder } from "extension-toolkit/base";
import { ExtensionContextService, IExtensionContextService } from "extension-toolkit/vscode";
import * as constants from "./common/constants";
import MainController from "./controllers/mainController";
import { TelemetryReporter } from "./common/telemetry";
import { SqlDatabaseProjectProvider } from "./projectProvider/projectProvider";
import { SqlDatabaseProjectTaskProvider } from "./tasks/sqlDatabaseProjectTaskProvider";

let activation: SqlDatabaseProjectsActivation | undefined;

export function activate(context: vscode.ExtensionContext): Promise<SqlDatabaseProjectProvider> {
    const builder = new InstantiationServiceBuilder();

    builder.define(IExtensionContextService, new ExtensionContextService(context));

    const instantiationService = builder.seal();
    context.subscriptions.push(instantiationService);

    activation = instantiationService.createInstance(SqlDatabaseProjectsActivation);
    return activation.activate();
}

export function deactivate(): void {
    activation?.deactivate();
}

class SqlDatabaseProjectsActivation {
    private readonly _controllers: MainController[] = [];

    constructor(
        @IExtensionContextService private readonly _contextService: IExtensionContextService,
    ) {}

    activate(): Promise<SqlDatabaseProjectProvider> {
        const context = this._contextService.context;
        const mainController = new MainController(context);

        this._controllers.push(mainController);
        context.subscriptions.push(mainController);
        context.subscriptions.push(TelemetryReporter);

        const taskProvider = vscode.tasks.registerTaskProvider(
            constants.sqlProjTaskType,
            new SqlDatabaseProjectTaskProvider(),
        );
        context.subscriptions.push(taskProvider);

        return mainController.activate();
    }

    deactivate(): void {
        for (const controller of this._controllers) {
            controller.deactivate();
        }
    }
}
