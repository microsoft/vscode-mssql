/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Field, Input, Dropdown, Option } from "@fluentui/react-components";
import { FormItemType } from "../../../../sharedInterfaces/form";
import type {
    IPublishForm,
    PublishProjectProvider,
} from "../../../../sharedInterfaces/publishDialog";

/**
 * Renders a form input field for the Publish Project dialog.
 * This is a shared helper to avoid duplication until the form infrastructure is upgraded.
 */
export const renderInput = (
    component:
        | {
              propertyName: string;
              hidden?: boolean;
              required?: boolean;
              label: string;
              placeholder?: string;
              validation?: { isValid: boolean; validationMessage?: string };
              type: FormItemType;
          }
        | undefined,
    value: string,
    setValue: (v: string) => void,
    context: PublishProjectProvider,
) => {
    if (!component || component.hidden) {
        return undefined;
    }
    if (component.type !== FormItemType.Input) {
        return undefined;
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
            <Input
                size="small"
                value={value}
                placeholder={component.placeholder ?? ""}
                onChange={(_, data) => {
                    setValue(data.value);
                    context.formAction({
                        propertyName: component.propertyName as keyof IPublishForm,
                        isAction: false,
                        value: data.value,
                    });
                }}
            />
        </Field>
    );
};

/**
 * Renders a dropdown field for the Publish Project dialog.
 * This is a shared helper to avoid duplication until the form infrastructure is upgraded.
 */
export const renderDropdown = (
    component:
        | {
              propertyName: string;
              hidden?: boolean;
              required?: boolean;
              label: string;
              placeholder?: string;
              validation?: { isValid: boolean; validationMessage?: string };
              type: FormItemType;
              options?: Array<{ value: string; displayName: string; color?: string }>;
          }
        | undefined,
    value: string | undefined,
    setValue: (v: string) => void,
    context: PublishProjectProvider,
) => {
    if (!component || component.hidden) {
        return undefined;
    }
    if (component.type !== FormItemType.Dropdown || !component.options) {
        return undefined;
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
                selectedOptions={value ? [value] : []}
                value={component.options.find((o) => o.value === value)?.displayName || ""}
                placeholder={component.placeholder ?? ""}
                onOptionSelect={(_, data) => {
                    setValue(data.optionValue as string);
                    context.formAction({
                        propertyName: component.propertyName as keyof IPublishForm,
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
