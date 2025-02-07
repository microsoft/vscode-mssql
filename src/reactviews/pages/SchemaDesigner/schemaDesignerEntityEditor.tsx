/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IEntity } from "../../../sharedInterfaces/schemaDesigner";

export const SchemaDesignerEntityEditor = (props: { entity: IEntity }) => {
    if (!props.entity) {
        return undefined;
    }
    return <div>{props.entity.name}</div>;
};
