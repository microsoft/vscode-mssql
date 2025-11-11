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
};

export const DesignerCheckbox = ({
    component,
    model,
    componentPath,
    UiArea,
    showLabel = true,
}: DesignerCheckboxProps) => {
    const [value, setValue] = useState(model.checked);
    const context = useContext(TableDesignerContext);
    if (!context) {
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
                    <Label
                        size="small"
                        style={{
                            lineHeight: "16px", // Used to align the label with the checkbox
                        }}>
                        {component.componentProperties.title!}
                    </Label>
                ) : undefined
            }
            orientation="horizontal"
            style={{
                width:
                    (component.componentProperties.width ?? UiArea === "PropertiesView")
                        ? "100%"
                        : "400px",
            }}>
            <Checkbox
                ref={(el) => context.addElementRef(componentPath, el, UiArea)}
                checked={value}
                onChange={async (_event, data) => {
                    if (model.enabled === false) {
                        return;
                    }
                    await context.processTableEdit({
                        path: componentPath,
                        value: data.checked,
                        type: DesignerEditType.Update,
                        source: UiArea,
                    });
                }}
                size="medium"
                disabled={model.enabled === undefined ? false : !model.enabled}
            />
        </Field>
    );
};
