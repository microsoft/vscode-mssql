/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { locConstants } from "./locConstants";

export function getDefinitionPanelScriptTabLabel(label?: string): string {
    return label ?? locConstants.schemaDesigner.definition;
}
