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
    DropDownProperties,
} from "../../../sharedInterfaces/tableDesigner";
import {
    Dropdown,
    useId,
    Option,
    Field,
    InfoLabel,
} from "@fluentui/react-components";

export type DesignerDropdownProps = {
    component: DesignerDataPropertyInfo;
    model: DropDownProperties;
    componentPath: (string | number)[];
    UiArea: DesignerUIArea;
    showLabel?: boolean;
    showError?: boolean;
    horizontal?: boolean;
};

export const DesignerDropdown = ({
    component,
    model,
    componentPath,
    UiArea,
    showLabel = true,
    showError = true,
    horizontal = false,
}: DesignerDropdownProps) => {
    const [value, setValue] = useState<string[]>([]);
    const state = useContext(TableDesignerContext);
    if (!state) {
        return undefined;
    }
    const width =
        UiArea === "PropertiesView"
            ? "100%"
            : (component.componentProperties.width ?? "350px");
    const dropdownId = useId(
        state?.provider.getComponentId(componentPath) ?? "",
    );

    useEffect(() => {
        setValue([model.value]);
    }, [model]);

    return (
        <Field
            label={{
                children: showLabel ? (
                    <InfoLabel size="small" info={component.description}>
                        {showLabel
                            ? component.componentProperties.title
                            : undefined}
                    </InfoLabel>
                ) : undefined,
            }}
            validationState={
                showError && state?.provider.getErrorMessage(componentPath)
                    ? "error"
                    : undefined
            }
            validationMessage={
                showError ? state?.provider.getErrorMessage(componentPath) : ""
            }
            style={{ width: width }}
            size="small"
            orientation={horizontal ? "horizontal" : "vertical"}
        >
            <Dropdown
                aria-labelledby={dropdownId}
                ref={(el) => state.addElementRef(componentPath, el, UiArea)}
                selectedOptions={value}
                disabled={model.enabled === undefined ? false : !model.enabled}
                style={{
                    width: width,
                    minWidth: width,
                    maxWidth: width,
                    border: state?.provider.getErrorMessage(componentPath)
                        ? "1px solid var(--vscode-errorForeground)"
                        : undefined,
                }}
                value={model.value}
                size="small"
                onOptionSelect={(_event, option) => {
                    if (model.enabled === false) {
                        return;
                    }
                    state?.provider.processTableEdit({
                        path: componentPath,
                        value: option.optionValue!.toString(),
                        type: DesignerEditType.Update,
                        source: UiArea,
                    });
                }}
                aria-errormessage={
                    state?.provider.getErrorMessage(componentPath) ?? ""
                }
            >
                {model.values
                    .sort((a, b) => a.localeCompare(b))
                    .map((option, index) => (
                        <Option
                            key={componentPath.join(".") + index}
                            text={option}
                            value={option}
                        >
                            {option}
                        </Option>
                    ))}
            </Dropdown>
        </Field>
    );
};
