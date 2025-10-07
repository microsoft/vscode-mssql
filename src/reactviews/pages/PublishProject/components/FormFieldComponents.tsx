/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Field, Dropdown, Option, Input, Checkbox, Button } from "@fluentui/react-components";
import { EyeOffRegular, EyeRegular } from "@fluentui/react-icons";
import { FormItemType } from "../../../../sharedInterfaces/form";
import type {
    IPublishForm,
    PublishProjectProvider,
    PublishDialogFormItemSpec,
} from "../../../../sharedInterfaces/publishDialog";

export const renderInput = (
    component: PublishDialogFormItemSpec | undefined,
    value: string,
    setValue: (v: string) => void,
    _context: PublishProjectProvider,
    options?: {
        inputType?: FormItemType;
        onBlur?: (value: string) => void;
        showPassword?: boolean;
        onTogglePassword?: () => void;
    },
) => {
    if (!component || component.hidden) return undefined;
    if (component.type !== FormItemType.Input && component.type !== FormItemType.Password) {
        return undefined;
    }

    const isPasswordField =
        options?.inputType === FormItemType.Password || component.type === FormItemType.Password;

    const handleChange = (_: React.FormEvent<HTMLInputElement>, data: { value: string }) => {
        setValue(data.value);
    };

    const handleBlur = () => {
        if (options?.onBlur) {
            options.onBlur(value);
        }
    };

    return (
        <Field
            key={component.propertyName}
            required={component.required}
            label={component.label}
            validationMessage={component.validation?.validationMessage}
            validationState={
                component.validation ? (component.validation.isValid ? "none" : "error") : "none"
            }
            orientation="horizontal">
            <Input
                key={component.propertyName}
                size="small"
                type={isPasswordField ? (options?.showPassword ? "text" : "password") : "text"}
                value={value}
                placeholder={component.placeholder ?? ""}
                onChange={handleChange}
                onBlur={handleBlur}
                contentAfter={
                    isPasswordField ? (
                        <Button
                            onClick={options?.onTogglePassword}
                            icon={options?.showPassword ? <EyeRegular /> : <EyeOffRegular />}
                            appearance="transparent"
                            size="small"
                            aria-label={options?.showPassword ? "Hide password" : "Show password"}
                            title={options?.showPassword ? "Hide password" : "Show password"}
                        />
                    ) : undefined
                }
            />
        </Field>
    );
};

export const renderDropdown = (
    component: PublishDialogFormItemSpec | undefined,
    value: string | undefined,
    setValue: (v: string) => void,
    context: PublishProjectProvider,
) => {
    if (!component || component.hidden) return undefined;
    if (component.type !== FormItemType.Dropdown || !component.options) return undefined;

    return (
        <Field
            key={component.propertyName}
            required={component.required}
            label={component.label}
            validationMessage={component.validation?.validationMessage}
            validationState={
                component.validation ? (component.validation.isValid ? "none" : "error") : "none"
            }
            orientation="horizontal">
            <Dropdown
                size="small"
                selectedOptions={value ? [value] : []}
                value={
                    component.options.find(
                        (o: { value: string; displayName: string }) => o.value === value,
                    )?.displayName || ""
                }
                placeholder={component.placeholder ?? ""}
                onOptionSelect={(
                    _: React.SyntheticEvent,
                    data: { optionValue: string | undefined },
                ) => {
                    if (data.optionValue) {
                        setValue(data.optionValue);
                        context.formAction({
                            propertyName: component.propertyName as keyof IPublishForm,
                            isAction: false,
                            value: data.optionValue,
                        });
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

export const CheckboxField = ({
    component,
    checked,
    onChange,
    label,
    getValidationState,
}: {
    component: PublishDialogFormItemSpec | undefined;
    checked: boolean;
    onChange: (checked: boolean) => void;
    label?: React.ReactNode;
    getValidationState?: (validation: PublishDialogFormItemSpec["validation"]) => "none" | "error";
}) => {
    if (!component || component.hidden) return undefined;

    const labelContent = label ?? component.label;
    const validationState = getValidationState
        ? getValidationState(component.validation)
        : component.validation
          ? component.validation.isValid
              ? "none"
              : "error"
          : "none";

    return (
        <Field
            key={component.propertyName}
            required={component.required}
            validationMessage={component.validation?.validationMessage}
            validationState={validationState}>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    whiteSpace: "nowrap",
                }}>
                <Checkbox
                    checked={checked}
                    onChange={(
                        _: React.FormEvent<HTMLInputElement>,
                        data: { checked: boolean | "mixed" },
                    ) => onChange(data.checked === true)}
                />
                <span style={{ whiteSpace: "normal" }}>{labelContent}</span>
            </div>
        </Field>
    );
};
