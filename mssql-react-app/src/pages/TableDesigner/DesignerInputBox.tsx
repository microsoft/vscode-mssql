/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react"
import { TableDesignerContext } from "./TableDesignerStateProvider"
import { DesignerDataPropertyInfo, DesignerEditType, DesignerUIArea, InputBoxProperties } from "./tableDesignerInterfaces"
import { Field, InfoLabel, Input, Textarea, useId } from "@fluentui/react-components"

export type DesignerInputBoxProps = {
    component: DesignerDataPropertyInfo,
    model: InputBoxProperties,
    componentPath: (string | number)[],
    UiArea: DesignerUIArea,
    multiline?: boolean,
    autoAdjustHeight?: boolean,
    showLabel?: boolean
    showError?: boolean
    id?: string
}

export const DesignerInputBox = ({
    component,
    model,
    componentPath,
    UiArea,
    multiline = false,
    showLabel = true,
    showError = true,
}: DesignerInputBoxProps) => {
    const [value, setValue] = useState(model.value);
    const state = useContext(TableDesignerContext);
    const dropdownId = useId(state?.provider.getComponentId(componentPath) ?? '');
    const width = UiArea === 'PropertiesView' ? '100%' : component.componentProperties.width ?? '400px';
    useEffect(() => {
        setValue(model.value);
    }, [model]);

    return <Field
    label={{
        children: showLabel ? <InfoLabel size="small" info={component.description}>
        {showLabel ? component.componentProperties.title : undefined}
      </InfoLabel> : undefined
      }}
        validationState={(state?.provider.getErrorMessage(componentPath)) ? 'error' : undefined}
        validationMessage={showError ? state?.provider.getErrorMessage(componentPath): undefined}
        style={{ width: width }}
        size="small"
    >
        {!multiline ?
        <Input
            aria-labelledby={dropdownId}
            id={state?.provider.getComponentId(componentPath)}
            value={value}
            onChange={(_event, newValue) => {
                setValue(newValue.value ?? '');
            }}
            onBlur={async () => {
                if (value === model.value) {
                    return;
                }
                await state?.provider.processTableEdit({
                    path: componentPath,
                    value: value,
                    type: DesignerEditType.Update,
                    source: UiArea
                }
                )
            }}
            disabled={model.enabled === undefined ? false : !model.enabled}
            type = {model.inputType}
            size="small"
        /> :
        <Textarea
            aria-labelledby={dropdownId}
            id={state?.provider.getComponentId(componentPath)}
            value={value}
            onChange={(_event, newValue) => {
                setValue(newValue.value ?? '');
            }}
            onBlur={async () => {
                if (value === model.value) {
                    return;
                }
                await state?.provider.processTableEdit({
                    path: componentPath,
                    value: value,
                    type: DesignerEditType.Update,
                    source: UiArea
                }
                )
            }}
            disabled={model.enabled === undefined ? false : !model.enabled}
            size='small'
        />
    }
    </Field>
}