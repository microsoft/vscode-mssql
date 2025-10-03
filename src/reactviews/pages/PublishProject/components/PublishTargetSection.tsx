/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState, useEffect } from "react";
import { Field, Dropdown, Option } from "@fluentui/react-components";
import { PublishProjectContext } from "../publishProjectStateProvider";
import { usePublishDialogSelector } from "../publishDialogSelector";
import { FormItemType } from "../../../../sharedInterfaces/form";

export const PublishTargetSection: React.FC = () => {
    const publishCtx = useContext(PublishProjectContext);
    const component = usePublishDialogSelector((s) => s.formComponents.publishTarget);
    const value = usePublishDialogSelector((s) => s.formState.publishTarget);
    const [localValue, setLocalValue] = useState<string | undefined>(value);

    useEffect(() => {
        setLocalValue(value);
    }, [value]);

    if (!publishCtx || !component || component.hidden) {
        return undefined;
    }

    if (component.type !== FormItemType.Dropdown || !component.options) {
        return undefined; // publishTarget is expected to be a dropdown
    }

    return (
        <Field
            key={component.propertyName}
            required={component.required}
            label={<span dangerouslySetInnerHTML={{ __html: component.label }} />}
            validationMessage={component.validation?.validationMessage}
            validationState={
                component.validation ? (component.validation.isValid ? "none" : "error") : "none"
            }
            orientation="horizontal">
            <Dropdown
                size="small"
                selectedOptions={localValue ? [localValue] : []}
                value={component.options.find((o) => o.value === localValue)?.displayName || ""}
                placeholder={component.placeholder ?? ""}
                onOptionSelect={(_, data) => {
                    setLocalValue(data.optionValue as string);
                    publishCtx.formAction({
                        propertyName: component.propertyName,
                        isAction: false,
                        value: data.optionValue as string,
                    });
                }}>
                {component.options.map((opt, i) => (
                    <Option key={opt.value + i} value={opt.value} color={opt.color}>
                        {opt.displayName}
                    </Option>
                ))}
            </Dropdown>
        </Field>
    );
};
