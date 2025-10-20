/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Field, Dropdown, Option, Input, Checkbox, Button } from "@fluentui/react-components";
import { EyeOffRegular, EyeRegular } from "@fluentui/react-icons";
import { FormItemType } from "../../../../sharedInterfaces/form";
import type { PublishDialogFormItemSpec } from "../../../../sharedInterfaces/publishDialog";
import { locConstants } from "../../../common/locConstants";
import type { PublishProjectContextProps } from "../publishProjectStateProvider";
import { useEffect, useState } from "react";

// Helper to get validation state from component
function getValidationState(validation: PublishDialogFormItemSpec["validation"]): "none" | "error" {
    return validation ? (validation.isValid ? "none" : "error") : "none";
}

// Generic Input Field - can be used for text, number, or password fields
// Manages its own local state and calls formAction on change (no validation) and blur (with validation)
export function InputField({
    context,
    component,
    value,
}: {
    context: PublishProjectContextProps | undefined;
    component: PublishDialogFormItemSpec | undefined;
    value: string;
}) {
    const [localValue, setLocalValue] = useState(value);
    const [showPassword, setShowPassword] = useState(false);

    // Sync local state with external state when it changes
    useEffect(() => {
        setLocalValue(value);
    }, [value]);

    if (!context || !component || component.hidden) return undefined;
    if (component.type !== FormItemType.Input && component.type !== FormItemType.Password) {
        return undefined;
    }

    const isPasswordField = component.type === FormItemType.Password;

    const handleChange = (newValue: string) => {
        setLocalValue(newValue);
        context.formAction({
            propertyName: component.propertyName,
            isAction: false,
            value: newValue,
            updateValidation: false,
        });
    };

    const handleBlur = () => {
        context.formAction({
            propertyName: component.propertyName,
            isAction: false,
            value: localValue,
            updateValidation: true,
        });
    };

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
                type={isPasswordField ? (showPassword ? "text" : "password") : "text"}
                value={localValue}
                placeholder={component.placeholder ?? ""}
                required={component.required}
                onChange={(_, data) => handleChange(data.value)}
                onBlur={handleBlur}
                contentAfter={
                    isPasswordField ? (
                        <Button
                            onClick={() => setShowPassword(!showPassword)}
                            icon={showPassword ? <EyeRegular /> : <EyeOffRegular />}
                            appearance="transparent"
                            size="small"
                            aria-label={
                                showPassword
                                    ? locConstants.common.hidePassword
                                    : locConstants.common.showPassword
                            }
                            title={
                                showPassword
                                    ? locConstants.common.hidePassword
                                    : locConstants.common.showPassword
                            }
                        />
                    ) : undefined
                }
            />
        </Field>
    );
}

// Backward compatibility wrapper - deprecated, use InputField component instead
export function renderInput(
    component: PublishDialogFormItemSpec | undefined,
    value: string,
    onChange: (value: string) => void,
    options?: {
        onBlur?: (value: string) => void;
        showPassword?: boolean;
        onTogglePassword?: () => void;
    },
) {
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
                            aria-label={
                                options.showPassword
                                    ? locConstants.common.hidePassword
                                    : locConstants.common.showPassword
                            }
                            title={
                                options.showPassword
                                    ? locConstants.common.hidePassword
                                    : locConstants.common.showPassword
                            }
                        />
                    ) : undefined
                }
            />
        </Field>
    );
}

// Generic Dropdown Field - can be used for any dropdown selection
export function renderDropdown(
    component: PublishDialogFormItemSpec | undefined,
    value: string | undefined,
    onChange: (value: string) => void,
) {
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
}

// Generic Checkbox Field - can be used for any checkbox
export function renderCheckbox(
    component: PublishDialogFormItemSpec | undefined,
    checked: boolean,
    onChange: (checked: boolean) => void,
    label?: React.ReactNode,
) {
    if (!component || component.hidden) return undefined;

    // Use provided label, or fall back to component.label
    // If component.label is a string, render it with dangerouslySetInnerHTML to support HTML
    const labelContent =
        label ??
        (typeof component.label === "string" ? (
            <span dangerouslySetInnerHTML={{ __html: component.label }} />
        ) : (
            component.label
        ));

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
}
