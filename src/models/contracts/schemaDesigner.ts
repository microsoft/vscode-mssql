/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotificationType, RequestType } from "vscode-languageclient";
import { SchemaDesigner } from "../../sharedInterfaces/schemaDesigner";

export namespace SchemaDesignerRequests {
    export namespace CreateSession {
        export const type = new RequestType<
            SchemaDesigner.CreateSessionRequest,
            SchemaDesigner.CreateSessionResponse,
            void,
            void
        >("schemaDesigner/createSession");
    }

    export namespace DisposeSession {
        export const type = new RequestType<
            SchemaDesigner.DisposeSessionRequest,
            void,
            void,
            void
        >("schemaDesigner/disposeSession");
    }

    export namespace GenerateScript {
        export const type = new RequestType<
            SchemaDesigner.GenerateScriptRequest,
            SchemaDesigner.GenerateScriptResponse,
            void,
            void
        >("schemaDesigner/generateScript");
    }

    export namespace SchemaReady {
        export const type = new NotificationType<
            SchemaDesigner.SchemaDesignerSession,
            void
        >("schemaDesigner/schemaReady");
    }
}
