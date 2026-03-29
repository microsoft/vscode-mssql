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
import { Field, InfoLabel } from "@fluentui/react-components";
import { SearchableDropdown } from "../../common/searchableDropdown.component";

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
    const context = useContext(TableDesignerContext);
    if (!context) {
        return undefined;
    }
    const width =
        UiArea === "PropertiesView" ? "100%" : (component.componentProperties.width ?? "350px");
    //const dropdownId = useId(context.getComponentId(componentPath) ?? "");

    useEffect(() => {
        setValue([model.value]);
    }, [model]);

    return (
        <Field
            label={
                showLabel
                    ? {
                          children: (
                              <InfoLabel
                                  size="small"
                                  info={component.description}
                                  aria-hidden="true">
                                  {component.componentProperties.title}
                              </InfoLabel>
                          ),
                      }
                    : undefined
            }
            validationState={
                showError && context.getErrorMessage(componentPath) ? "error" : undefined
            }
            validationMessage={showError ? context.getErrorMessage(componentPath) : ""}
            style={{ width: width }}
            size="small"
            orientation={horizontal ? "horizontal" : "vertical"}>
            <SearchableDropdown
                style={{
                    width: width,
                    minWidth: width,
                    maxWidth: width,
                    height: "100%",
                    border: context.getErrorMessage(componentPath)
                        ? "1px solid var(--vscode-errorForeground)"
                        : undefined,
                }}
                options={model.values
                    .sort((a, b) => a.localeCompare(b))
                    .map((option) => ({
                        text: option,
                        value: option,
                    }))}
                onSelect={(option) => {
                    if (model.enabled === false) {
                        return;
                    }
                    context.processTableEdit({
                        path: componentPath,
                        value: option.value.toString(),
                        type: DesignerEditType.Update,
                        source: UiArea,
                    });
                }}
                size="small"
                selectedOption={{
                    value: value[0],
                }}
                ariaLabel={component.componentProperties.title}
            />
        </Field>
    );
};
