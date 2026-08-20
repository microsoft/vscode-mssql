/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ObjectMetadata, PrincipalMetadata } from "../metadata/index.js";

export function qualifiedCatalogName(object: ObjectMetadata): string {
    return [object.database, object.schema, object.name].filter(Boolean).join(".");
}

export function principalHoverMarkdown(principal: PrincipalMetadata): string {
    return `**${principal.system ? "system " : ""}${principal.kind}** \`${principal.name}\`${
        principal.database ? `\n\nDatabase: \`${principal.database}\`` : ""
    }`;
}
