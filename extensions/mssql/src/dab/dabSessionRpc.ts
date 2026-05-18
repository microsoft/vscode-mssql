/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotificationType, RequestType } from "vscode-jsonrpc/browser";
import { Dab } from "../sharedInterfaces/dab";
import { SchemaDesigner } from "../sharedInterfaces/schemaDesigner";

export interface DabUpdateSchemaParams {
    schemaTables: SchemaDesigner.Table[];
}

export interface DabSnapshot {
    sessionId: string;
    version: string;
    summary: Dab.DabToolSummary;
    config?: Dab.DabConfig;
    stateOmittedReason?: "entity_count_over_threshold";
}

export interface DabUpdateSchemaResponse {
    snapshot: DabSnapshot;
}

type DabApplyFailureReason = Extract<Dab.ApplyDabToolChangesResponse, { success: false }>["reason"];

export interface DabApplyFailedNotification {
    sessionId: string;
    source?: Dab.DabCommandSource;
    version?: string;
    reason: DabApplyFailureReason;
    message: string;
}

export namespace DabSessionRpc {
    export namespace UpdateSchemaRequest {
        export const type = new RequestType<DabUpdateSchemaParams, DabUpdateSchemaResponse, void>(
            "dab/session/updateSchema",
        );
    }

    export namespace SnapshotChangedNotification {
        export const type = new NotificationType<DabSnapshot>("dab/session/snapshotChanged");
    }

    export namespace ApplyFailedNotification {
        export const type = new NotificationType<DabApplyFailedNotification>(
            "dab/session/applyFailed",
        );
    }
}
