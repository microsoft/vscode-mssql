/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import {
    mergeCopilotEnableMap,
    resolveCopilotEnableTarget,
} from "../../src/copilot/copilotEnableSettingsGuard";

suite("CopilotEnableSettingsGuard Tests", () => {
    test("mergeCopilotEnableMap handles the required merge cases", () => {
        expect(mergeCopilotEnableMap(undefined)).to.deep.equal({ "*": true, sql: false });
        expect(mergeCopilotEnableMap(null)).to.deep.equal({ "*": true, sql: false });
        expect(mergeCopilotEnableMap({})).to.deep.equal({ "*": true, sql: false });
        expect(mergeCopilotEnableMap({ "*": true })).to.deep.equal({ "*": true, sql: false });
        expect(mergeCopilotEnableMap({ sql: true })).to.deep.equal({ sql: false });
        expect(mergeCopilotEnableMap({ python: false })).to.deep.equal({
            python: false,
            sql: false,
        });
        expect(mergeCopilotEnableMap({ "*": false, sql: false })).to.deep.equal({
            "*": false,
            sql: false,
        });
    });

    test("resolveCopilotEnableTarget prefers workspace folder over workspace and global", () => {
        expect(
            resolveCopilotEnableTarget(
                inspectWithValues({
                    globalValue: { "*": true },
                    workspaceValue: { "*": true },
                    workspaceFolderValue: { "*": true },
                }),
            ),
        ).to.deep.equal({
            target: vscode.ConfigurationTarget.WorkspaceFolder,
            wroteTarget: "workspaceFolder",
        });

        expect(
            resolveCopilotEnableTarget(
                inspectWithValues({
                    globalValue: { "*": true },
                    workspaceValue: { "*": true },
                }),
            ),
        ).to.deep.equal({
            target: vscode.ConfigurationTarget.Workspace,
            wroteTarget: "workspace",
        });

        expect(
            resolveCopilotEnableTarget(
                inspectWithValues({
                    globalValue: { "*": true },
                }),
            ),
        ).to.deep.equal({
            target: vscode.ConfigurationTarget.Global,
            wroteTarget: "global",
        });

        expect(resolveCopilotEnableTarget(undefined)).to.deep.equal({
            target: vscode.ConfigurationTarget.Global,
            wroteTarget: "global",
        });
    });
});

function inspectWithValues(values: {
    globalValue?: Record<string, boolean> | null;
    workspaceValue?: Record<string, boolean> | null;
    workspaceFolderValue?: Record<string, boolean> | null;
}): {
    key: string;
    defaultValue: undefined;
    globalValue?: Record<string, boolean> | null;
    workspaceValue?: Record<string, boolean> | null;
    workspaceFolderValue?: Record<string, boolean> | null;
} {
    return {
        key: "enable",
        defaultValue: undefined,
        globalValue: values.globalValue,
        workspaceValue: values.workspaceValue,
        workspaceFolderValue: values.workspaceFolderValue,
    };
}
