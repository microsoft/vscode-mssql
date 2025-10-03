/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Field, Dropdown, Option, Input, Checkbox, Button } from "@fluentui/react-components";
import { EyeOffRegular, EyeRegular } from "@fluentui/react-icons";
import { FormItemType } from "../../../../sharedInterfaces/form";
import { PublishDialogFormItemSpec } from "../../../../sharedInterfaces/publishDialog";
import { useState } from "react";

/**
 * Reusable Input field component with validation
 */
export const InputField: React.FC<{
    component: PublishDialogFormItemSpec | undefined;
    value: string;
    onChange: (value: string) => void;
    onBlur?: (value: string) => void; // Optional blur handler, receives current value
    type?: "text" | "password" | "email" | "tel" | "url";
    getValidationState: (validation: PublishDialogFormItemSpec["validation"]) => "none" | "error";
}> = ({ component, value, onChange, onBlur, type = "text", getValidationState }) => {
    const [showPassword, setShowPassword] = useState(false);

    if (!component || component.hidden) return undefined;

    const isPassword = type === "password";
    const inputType = isPassword ? (showPassword ? "text" : "password") : type;

    const handleBlur = () => {
        if (onBlur) {
            onBlur(value);
        }
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
                size="small"
                type={inputType}
                value={value}
                placeholder={component.placeholder ?? ""}
                onChange={(_, data) => onChange(data.value)}
                onBlur={handleBlur}
                contentAfter={
                    isPassword ? (
                        <Button
                            onClick={() => setShowPassword(!showPassword)}
                            icon={showPassword ? <EyeRegular /> : <EyeOffRegular />}
                            appearance="transparent"
                            size="small"
                            aria-label={showPassword ? "Hide password" : "Show password"}
                            title={showPassword ? "Hide password" : "Show password"}
                        />
                    ) : undefined
                }
            />
        </Field>
    );
};

/**
 * Reusable Dropdown field component with validation
 */
export const DropdownField: React.FC<{
    component: PublishDialogFormItemSpec | undefined;
    value: string | undefined;
    onChange: (value: string) => void;
    getValidationState: (validation: PublishDialogFormItemSpec["validation"]) => "none" | "error";
}> = ({ component, value, onChange, getValidationState }) => {
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
                size="small"
                selectedOptions={value ? [value] : []}
                value={component.options.find((o) => o.value === value)?.displayName || ""}
                placeholder={component.placeholder ?? ""}
                onOptionSelect={(_, data) => onChange(data.optionValue as string)}>
                {component.options.map((opt, i) => (
                    <Option key={opt.value + i} value={opt.value} color={opt.color}>
                        {opt.displayName}
                    </Option>
                ))}
            </Dropdown>
        </Field>
    );
};

/**
 * Reusable Checkbox field component with validation
 */
export const CheckboxField: React.FC<{
    component: PublishDialogFormItemSpec | undefined;
    checked: boolean;
    onChange: (checked: boolean) => void;
    label?: React.ReactNode; // Optional pre-parsed label to override component.label
    getValidationState: (validation: PublishDialogFormItemSpec["validation"]) => "none" | "error";
}> = ({ component, checked, onChange, label, getValidationState }) => {
    if (!component || component.hidden) return undefined;

    // Use provided label or fall back to component.label
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
                <span style={{ whiteSpace: "normal" }}>{labelContent}</span>
            </div>
        </Field>
    );
};
