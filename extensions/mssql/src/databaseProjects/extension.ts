/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as constants from "./common/constants";
import MainController from "./controllers/mainController";
import { SqlDatabaseProjectProvider } from "./projectProvider/projectProvider";
import { SqlDatabaseProjectTaskProvider } from "./tasks/sqlDatabaseProjectTaskProvider";

export class SqlDatabaseProjectsRegistration implements vscode.Disposable {
    private readonly _controllers: MainController[] = [];

    constructor(private readonly context: vscode.ExtensionContext) {}

    activate(): Promise<SqlDatabaseProjectProvider> {
        const mainController = new MainController(this.context);

        this._controllers.push(mainController);
        this.context.subscriptions.push(mainController);
        const taskProvider = vscode.tasks.registerTaskProvider(
            constants.sqlProjTaskType,
            new SqlDatabaseProjectTaskProvider(),
        );
        this.context.subscriptions.push(taskProvider);

        return mainController.activate();
    }

    deactivate(): void {
        for (const controller of this._controllers) {
            controller.deactivate();
        }
    }

    dispose(): void {
        this.deactivate();
    }
}

export function registerDatabaseProjects(
    context: vscode.ExtensionContext,
): Promise<SqlDatabaseProjectProvider> {
    const registration = new SqlDatabaseProjectsRegistration(context);
    context.subscriptions.push(registration);
    return registration.activate();
}
