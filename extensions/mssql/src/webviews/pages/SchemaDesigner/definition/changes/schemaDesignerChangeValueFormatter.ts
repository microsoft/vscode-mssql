/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { locConstants } from "../../../../common/locConstants";

export const formatSchemaDesignerChangeValue = (value: unknown): string => {
    if (value === "") {
        return locConstants.schemaDesigner.changesPanel.emptyValue;
    }

    if (value === undefined || value === null) {
        return locConstants.schemaDesigner.schemaDiff.undefinedValue;
    }

    if (Array.isArray(value)) {
        return value.map((entry) => String(entry)).join(", ");
    }

    if (typeof value === "string") {
        return value;
    }

    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
};
