/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotificationType, RequestType } from "vscode-languageclient";
import {
    GetSchemaModelRequestParams,
    GetSchemaModelResponse,
    ISchema,
    ModelReadyNotificationParams,
} from "../../sharedInterfaces/schemaDesigner";

export namespace GetSchemaModelRequest {
    export const type = new RequestType<
        GetSchemaModelRequestParams,
        GetSchemaModelResponse,
        void,
        void
    >("schemaDesigner/getSchemaModel");
}

export namespace PublishSchemaRequest {
    export const type = new RequestType<
        {
            modifiedSchema: ISchema;
        },
        void,
        void,
        void
    >("schemaDesigner/publishSchema");
}

export namespace ModelReadyNotification {
    export const type = new NotificationType<
        ModelReadyNotificationParams,
        void
    >("schemaDesigner/modelReady");
}
