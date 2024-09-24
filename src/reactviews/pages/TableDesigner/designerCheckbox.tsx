/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import { TableDesignerContext } from "./tableDesignerStateProvider";
import {
    CheckBoxProperties,
    DesignerDataPropertyInfo,
    DesignerEditType,
    DesignerUIArea,
} from "../../../sharedInterfaces/tableDesigner";
import { Checkbox, Field, Label } from "@fluentui/react-components";

export type DesignerCheckboxProps = {
    component: DesignerDataPropertyInfo;
    model: CheckBoxProperties;
    componentPath: (string | number)[];
    UiArea: DesignerUIArea;
    showLabel?: boolean;
    horizontal?: boolean;
};

export const DesignerCheckbox = ({
    component,
    model,
    componentPath,
    UiArea,
    showLabel = true,
    horizontal = false,
}: DesignerCheckboxProps) => {
    const [value, setValue] = useState(model.checked);
    const state = useContext(TableDesignerContext);
    if (!state) {
        return undefined;
    }
    useEffect(() => {
        setValue(model.checked);
    }, [model]);
    return (
        <Field
            size="small"
            label={
                showLabel ? (
                    <Label size="small">
                        {component.componentProperties.title!}
                    </Label>
                ) : undefined
            }
            orientation={horizontal ? "horizontal" : "vertical"}
        >
            <Checkbox
                ref={(el) => state.addElementRef(componentPath, el, UiArea)}
                checked={value}
                onChange={async (_event, data) => {
                    if (model.enabled === false) {
                        return;
                    }
                    await state?.provider.processTableEdit({
                        path: componentPath,
                        value: data.checked,
                        type: DesignerEditType.Update,
                        source: UiArea,
                    });
                }}
                style={{
                    fontSize: "12px",
                }}
                disabled={model.enabled === undefined ? false : !model.enabled}
            />
        </Field>
    );
};
