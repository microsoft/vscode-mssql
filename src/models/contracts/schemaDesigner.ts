/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotificationType, RequestType } from "vscode-languageclient";
import {
    GetSchemaModelRequestParams,
    ISchema,
} from "../../sharedInterfaces/schemaDesigner";

export namespace GetSchemaModelRequest {
    export const type = new RequestType<
        GetSchemaModelRequestParams,
        ISchema,
        void,
        void
    >("schemaDesigner/getSchemaModel");
}

export namespace ModelReadyNotification {
    export const type = new NotificationType<
        {
            model: ISchema;
            originalModel: ISchema;
        },
        void
    >("schemaDesigner/modelReady");
}
