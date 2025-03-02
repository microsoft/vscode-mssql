/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ReactWebviewPanelController } from "../controllers/reactWebviewPanelController";
import {
    ISchema,
    ISchemaDesignerService,
    SchemaDesignerReducers,
    SchemaDesignerWebviewState,
} from "../sharedInterfaces/schemaDesigner";
import VscodeWrapper from "../controllers/vscodeWrapper";
import * as LocConstants from "../constants/locConstants";

export class SchemaDesignerWebviewController extends ReactWebviewPanelController<
    SchemaDesignerWebviewState,
    SchemaDesignerReducers
> {
    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        public _schemaDesignerService: ISchemaDesignerService,
        _database: string,
        intialSchema: ISchema,
        sessionId: string,
    ) {
        super(
            context,
            vscodeWrapper,
            "schemaDesigner",
            "schemaDesigner",
            {
                schema: intialSchema,
            },
            {
                title: _database,
                viewColumn: vscode.ViewColumn.One,
                iconPath: {
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "visualizeSchema_light.svg",
                    ),
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "visualizeSchema_dark.svg",
                    ),
                },
                showRestorePromptAfterClose: false,
            },
        );

        this._schemaDesignerService.onModelReady((model) => {
            if (model.sessionId === sessionId) {
                console.log("Model ready", model.code);
            }
        });

        this.registerReducer("saveAsFile", async (state, payload) => {
            const outputPath = await vscode.window.showSaveDialog({
                filters: {
                    [payload.format]: [payload.format],
                },
                defaultUri: vscode.Uri.file(`newFile.${payload.format}`),
                saveLabel: LocConstants.SchemaDesigner.Save,
                title: LocConstants.SchemaDesigner.SaveAs,
            });
            if (payload.format === "svg") {
                let fileContents = decodeURIComponent(
                    payload.fileContents.split(",")[1],
                );
                await vscode.workspace.fs.writeFile(
                    outputPath,
                    Buffer.from(fileContents, "utf8"),
                );
            } else {
                let fileContents = Buffer.from(
                    payload.fileContents.split(",")[1],
                    "base64",
                );
                vscode.workspace.fs.writeFile(outputPath, fileContents);
            }

            return state;
        });
    }
}
