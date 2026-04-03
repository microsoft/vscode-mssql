/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as constants from "../../src/constants/constants";
import * as vscode from "vscode";
import { IExtension } from "vscode-mssql";

suite("Activation Tests", () => {
    let extension: vscode.Extension<IExtension> | undefined;
    let api: IExtension | undefined;

    suiteSetup(async () => {
        extension = vscode.extensions.getExtension<IExtension>(constants.extensionId);
        expect(extension, "Expected the mssql extension to be available in VS Code").to.not.be
            .undefined;

        api = await extension!.activate();
    });

    test("mssql extension activates successfully", async () => {
        expect(api, "Expected extension.activate() to resolve an API object").to.not.be.undefined;
    });

    test("registered commands appear in the VS Code command registry after activation", async () => {
        const commands = await vscode.commands.getCommands(true);
        expect(commands).to.include(constants.cmdConnect);
    });
});
