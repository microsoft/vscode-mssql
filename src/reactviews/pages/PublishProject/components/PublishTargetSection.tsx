/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState, useEffect } from "react";
import { PublishProjectContext } from "../publishProjectStateProvider";
import { usePublishDialogSelector } from "../publishDialogSelector";
import { renderDropdown } from "./FormFieldComponents";

export const PublishTargetSection: React.FC = () => {
    const publishCtx = useContext(PublishProjectContext);
    const component = usePublishDialogSelector((s) => s.formComponents.publishTarget);
    const value = usePublishDialogSelector((s) => s.formState.publishTarget);
    const [localValue, setLocalValue] = useState<string | undefined>(value);

    useEffect(() => {
        setLocalValue(value);
    }, [value]);

    if (!publishCtx) {
        return undefined;
    }

    return <>{renderDropdown(component, localValue, setLocalValue, publishCtx)}</>;
};
