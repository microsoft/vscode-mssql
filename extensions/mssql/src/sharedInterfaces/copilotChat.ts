/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-jsonrpc";

export namespace CopilotChat {
    export const openFromUiCommand = "mssql.openCopilotChatFromUi";
    const discoveryDismissedStateKeyPrefix = "mssql.copilotChatDiscoveryDismissed";

    export type Scenario = "schemaDesigner" | "dab";
    export type EntryPoint =
        | "schemaDesignerToolbar"
        | "schemaDesignerPublishDialogError"
        | "dabToolbar";

    export interface OpenFromUiArgs {
        scenario: Scenario;
        entryPoint: EntryPoint;
        prompt?: string;
    }

    export namespace OpenFromUiRequest {
        export const type = new RequestType<OpenFromUiArgs, void, void>("copilotChat/openFromUi");
    }

    export type DiscoveryDismissedState = Partial<Record<Scenario, boolean>>;

    export interface DismissDiscoveryPayload {
        scenario: Scenario;
    }

    export function getDiscoveryDismissedStateKey(scenario: Scenario): string {
        return `${discoveryDismissedStateKeyPrefix}.${scenario}`;
    }
}
