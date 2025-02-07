/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useRef } from "react";
import { IEntity } from "../../../sharedInterfaces/schemaDesigner";

export const SchemaDesignerEntityEditor = (props: { entity: IEntity }) => {
    const renderCount = useRef(0);
    renderCount.current += 1;
    console.log(
        `SchemaDesignerEntityEditor render count: ${renderCount.current}`,
    );
    if (!props.entity) {
        return undefined;
    }
    return <div>{props.entity.name}</div>;
};
