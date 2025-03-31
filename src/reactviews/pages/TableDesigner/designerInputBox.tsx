/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import { TableDesignerContext } from "./tableDesignerStateProvider";
import {
    DesignerDataPropertyInfo,
    DesignerEditType,
    DesignerUIArea,
    InputBoxProperties,
} from "../../../sharedInterfaces/tableDesigner";
import { Field, InfoLabel, Input, Textarea, useId } from "@fluentui/react-components";
import { ErrorCircleRegular } from "@fluentui/react-icons";

export type DesignerInputBoxProps = {
    component: DesignerDataPropertyInfo;
    model: InputBoxProperties;
    componentPath: (string | number)[];
    UiArea: DesignerUIArea;
    multiline?: boolean;
    autoAdjustHeight?: boolean;
    showLabel?: boolean;
    showError?: boolean;
    id?: string;
    horizontal?: boolean;
};

export const DesignerInputBox = ({
    component,
    model,
    componentPath,
    UiArea,
    multiline = false,
    showLabel = true,
    showError = true,
    horizontal = false,
}: DesignerInputBoxProps) => {
    const [value, setValue] = useState(model.value);
    const context = useContext(TableDesignerContext);

    if (!context) {
        return undefined;
    }
    const dropdownId = useId(context.getComponentId(componentPath) ?? "");
    const width =
        UiArea === "PropertiesView" ? "100%" : (component.componentProperties.width ?? "400px");
    useEffect(() => {
        setValue(model.value);
    }, [model]);

    return (
        <Field
            label={{
                children: showLabel ? (
                    <InfoLabel size="small" info={component.description}>
                        {showLabel ? component.componentProperties.title : undefined}
                    </InfoLabel>
                ) : undefined,
            }}
            validationState={context.getErrorMessage(componentPath) ? "error" : undefined}
            validationMessage={showError ? context.getErrorMessage(componentPath) : undefined}
            validationMessageIcon={
                showError && context.getErrorMessage(componentPath) ? (
                    <ErrorCircleRegular />
                ) : undefined
            }
            style={{ width: width }}
            size="small"
            orientation={horizontal ? "horizontal" : "vertical"}>
            {!multiline ? (
                <Input
                    aria-labelledby={dropdownId}
                    ref={(el) => context.addElementRef(componentPath, el, UiArea)}
                    value={value ?? ""}
                    onChange={(_event, newValue) => {
                        setValue(newValue.value ?? "");
                    }}
                    onBlur={async () => {
                        if (value === model.value) {
                            return;
                        }
                        await context.processTableEdit({
                            path: componentPath,
                            value: value,
                            type: DesignerEditType.Update,
                            source: UiArea,
                        });
                    }}
                    disabled={model.enabled === undefined ? false : !model.enabled}
                    type={model.inputType}
                    size="small"
                />
            ) : (
                <Textarea
                    aria-labelledby={dropdownId}
                    ref={(el) => context.addElementRef(componentPath, el, UiArea)}
                    value={value ?? ""}
                    onChange={(_event, newValue) => {
                        setValue(newValue.value ?? "");
                    }}
                    onBlur={async () => {
                        if (value === model.value) {
                            return;
                        }
                        await context?.processTableEdit({
                            path: componentPath,
                            value: value,
                            type: DesignerEditType.Update,
                            source: UiArea,
                        });
                    }}
                    disabled={model.enabled === undefined ? false : !model.enabled}
                    size="small"
                />
            )}
        </Field>
    );
};
