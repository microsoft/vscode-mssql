/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ReactWebviewPanelController } from "../controllers/reactWebviewPanelController";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { PublishProject as Loc } from "../constants/locConstants";

export class PublishProjectWebViewController extends ReactWebviewPanelController<
    PublishDialogState,
    PublishDialogReducers
> {
    constructor(context: vscode.ExtensionContext, _vscodeWrapper: VscodeWrapper) {
        super(
            context,
            _vscodeWrapper,
            "publishDialog",
            "Publish Database",
            {
                message: "Hello from Publish Dialog",
            },
            {
                title: Loc.Title,
                viewColumn: vscode.ViewColumn.Active,
                iconPath: {
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "schemaCompare_dark.svg",
                    ),
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "schemaCompare_light.svg",
                    ),
                },
            },
        );
    }

    protected get reducers(): Map<
        keyof PublishDialogReducers,
        (state: PublishDialogState, payload: any) => Promise<PublishDialogState>
    > {
        const reducerMap = new Map<
            keyof PublishDialogReducers,
            (state: PublishDialogState, payload: any) => Promise<PublishDialogState>
        >();

        reducerMap.set("test", async (state) => {
            console.log("Test reducer called");
            return state;
        });

        return reducerMap;
    }
}

export interface PublishDialogState {
    message: string;
}

export type PublishDialogReducers = {
    test: undefined;
};
