/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InMemoryMetadataProvider } from "./memoryMetadataProvider.js";

export class NullMetadataProvider extends InMemoryMetadataProvider {
    public constructor() {
        super(
            {
                completeness: {
                    databases: "unknown",
                    schemas: "unknown",
                    objects: "unknown",
                    columns: "unknown",
                    parameters: "unknown",
                    indexes: "unknown",
                    triggers: "unknown",
                    constraints: "unknown",
                    clrTypes: "unknown",
                    securables: "unknown",
                    collations: "unknown",
                    principals: "unknown",
                    definitions: "unknown",
                },
            },
            "null",
        );
    }
}
