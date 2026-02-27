/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export namespace CopilotChat {
    export const openFromUiCommand = "mssql.openCopilotChatFromUi";
    const discoveryDismissedStateKeyPrefix = "mssql.copilotChatDiscoveryDismissed";

    export type Scenario = "schemaDesigner" | "dab";
    export type EntryPoint = "schemaDesignerToolbar" | "dabToolbar";

    export interface OpenFromUiArgs {
        scenario: Scenario;
        entryPoint: EntryPoint;
    }

    export type DiscoveryDismissedState = Partial<Record<Scenario, boolean>>;

    export interface DismissDiscoveryPayload {
        scenario: Scenario;
    }

    export function getDiscoveryDismissedStateKey(scenario: Scenario): string {
        return `${discoveryDismissedStateKeyPrefix}.${scenario}`;
    }
}
