/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Field, Dropdown, Option, Input, Checkbox, Button } from "@fluentui/react-components";
import { EyeOffRegular, EyeRegular } from "@fluentui/react-icons";
import { FormItemType } from "../../../../sharedInterfaces/form";
import type { PublishDialogFormItemSpec } from "../../../../sharedInterfaces/publishDialog";

// Helper to get validation state from component
const getValidationState = (
    validation: PublishDialogFormItemSpec["validation"],
): "none" | "error" => {
    return validation ? (validation.isValid ? "none" : "error") : "none";
};

// Generic Input Field - can be used for text, number, or password fields
export const renderInput = (
    component: PublishDialogFormItemSpec | undefined,
    value: string,
    onChange: (value: string) => void,
    options?: {
        onBlur?: (value: string) => void;
        showPassword?: boolean;
        onTogglePassword?: () => void;
    },
) => {
    if (!component || component.hidden) return undefined;
    if (component.type !== FormItemType.Input && component.type !== FormItemType.Password) {
        return undefined;
    }

    const isPasswordField = component.type === FormItemType.Password;

    return (
        <Field
            key={component.propertyName}
            required={component.required}
            label={component.label}
            validationMessage={component.validation?.validationMessage}
            validationState={getValidationState(component.validation)}
            orientation="horizontal">
            <Input
                size="medium"
                type={isPasswordField ? (options?.showPassword ? "text" : "password") : "text"}
                value={value}
                placeholder={component.placeholder ?? ""}
                required={component.required}
                onChange={(_, data) => onChange(data.value)}
                onBlur={() => options?.onBlur?.(value)}
                contentAfter={
                    isPasswordField && options?.onTogglePassword ? (
                        <Button
                            onClick={options.onTogglePassword}
                            icon={options.showPassword ? <EyeRegular /> : <EyeOffRegular />}
                            appearance="transparent"
                            size="small"
                            aria-label={options.showPassword ? "Hide password" : "Show password"}
                            title={options.showPassword ? "Hide password" : "Show password"}
                        />
                    ) : undefined
                }
            />
        </Field>
    );
};

// Generic Dropdown Field - can be used for any dropdown selection
export const renderDropdown = (
    component: PublishDialogFormItemSpec | undefined,
    value: string | undefined,
    onChange: (value: string) => void,
) => {
    if (!component || component.hidden) return undefined;
    if (component.type !== FormItemType.Dropdown || !component.options) return undefined;

    return (
        <Field
            key={component.propertyName}
            required={component.required}
            label={component.label}
            validationMessage={component.validation?.validationMessage}
            validationState={getValidationState(component.validation)}
            orientation="horizontal">
            <Dropdown
                size="medium"
                selectedOptions={value ? [value] : []}
                value={
                    component.options.find(
                        (o: { value: string; displayName: string }) => o.value === value,
                    )?.displayName || ""
                }
                placeholder={component.placeholder ?? ""}
                onOptionSelect={(_, data) => {
                    if (data.optionValue) {
                        onChange(data.optionValue);
                    }
                }}>
                {component.options.map(
                    (opt: { value: string; displayName: string; color?: string }, i: number) => (
                        <Option key={opt.value + i} value={opt.value} color={opt.color}>
                            {opt.displayName}
                        </Option>
                    ),
                )}
            </Dropdown>
        </Field>
    );
};

// Generic Checkbox Field - can be used for any checkbox
export const renderCheckbox = (
    component: PublishDialogFormItemSpec | undefined,
    checked: boolean,
    onChange: (checked: boolean) => void,
    label?: React.ReactNode,
) => {
    if (!component || component.hidden) return undefined;

    const labelContent = label ?? component.label;

    return (
        <Field
            key={component.propertyName}
            required={component.required}
            validationMessage={component.validation?.validationMessage}
            validationState={getValidationState(component.validation)}>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    whiteSpace: "nowrap",
                }}>
                <Checkbox
                    checked={checked}
                    onChange={(_, data) => onChange(data.checked === true)}
                />
                <span style={{ whiteSpace: "normal" }}>
                    {labelContent}
                    {component.required && (
                        <span style={{ color: "red", marginLeft: "4px" }}>*</span>
                    )}
                </span>
            </div>
        </Field>
    );
};
