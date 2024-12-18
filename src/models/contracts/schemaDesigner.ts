/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-languageclient";
import { ISchema } from "../../sharedInterfaces/schemaDesigner";

export namespace GetSchemaModelRequest {
    export const type = new RequestType<string, ISchema, void, void>(
        "schemaDesigner/getSchemaModel",
    );
}
