/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-languageclient";
import { SchemaDesigner } from "../../sharedInterfaces/schemaDesigner";

export namespace SchemaDesignerRequests {
    /**
     * Represents a request to create a schema designer session
     */
    export namespace CreateSession {
        export const type = new RequestType<
            SchemaDesigner.CreateSessionRequest,
            SchemaDesigner.CreateSessionResponse,
            void,
            void
        >("schemaDesigner/createSession");
    }

    /**
     * Represents a request to dispose a schema designer session
     */
    export namespace DisposeSession {
        export const type = new RequestType<SchemaDesigner.DisposeSessionRequest, void, void, void>(
            "schemaDesigner/disposeSession",
        );
    }

    /**
     * Represents a request to generate a script for the schema designer changes
     */
    export namespace GenerateScript {
        export const type = new RequestType<
            SchemaDesigner.GenerateScriptRequest,
            SchemaDesigner.GenerateScriptResponse,
            void,
            void
        >("schemaDesigner/generateScript");
    }

    /**
     * Represents a request to get the definition of a schema designer session
     */
    export namespace GetDefinition {
        export const type = new RequestType<
            SchemaDesigner.GetDefinitionRequest,
            SchemaDesigner.GetDefinitionResponse,
            void,
            void
        >("schemaDesigner/getDefinition");
    }

    /**
     * Represents a request to get the report of a schema designer session
     */
    export namespace GetReport {
        export const type = new RequestType<
            SchemaDesigner.GetReportRequest,
            SchemaDesigner.GetReportResponse,
            void,
            void
        >("schemaDesigner/getReport");
    }

    /**
     * Represents a notification to update the schema designer model
     */
    export namespace PublishSession {
        export const type = new RequestType<SchemaDesigner.PublishSessionRequest, void, void, void>(
            "schemaDesigner/publishSession",
        );
    }
}
