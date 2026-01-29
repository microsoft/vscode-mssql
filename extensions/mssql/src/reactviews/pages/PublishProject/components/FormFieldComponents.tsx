/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Field,
    Dropdown,
    Option,
    Input,
    Checkbox,
    Button,
    Combobox,
} from "@fluentui/react-components";
import { EyeOffRegular, EyeRegular } from "@fluentui/react-icons";
import { FormItemType } from "../../../../sharedInterfaces/form";
import type { PublishDialogFormItemSpec } from "../../../../sharedInterfaces/publishDialog";
import { locConstants } from "../../../common/locConstants";
import type { PublishProjectContextProps } from "../publishProjectStateProvider";
import {
    SearchableDropdown,
    SearchableDropdownOptions,
} from "../../../common/searchableDropdown.component";

// Helper to get validation state from component
function getValidationState(validation: PublishDialogFormItemSpec["validation"]): "none" | "error" {
    return validation ? (validation.isValid ? "none" : "error") : "none";
}

// Generic Input Field - can be used for text, number, or password fields
// Automatically handles formAction with updateValidation: false on change, true on blur
export function renderInput(
    component: PublishDialogFormItemSpec | undefined,
    value: string,
    context: PublishProjectContextProps | undefined,
    options?: {
        showPassword?: boolean;
        onTogglePassword?: () => void;
        onChange?: (value: string) => void;
        readOnly?: boolean;
        contentAfter?: React.ReactElement;
    },
) {
    if (!component || component.hidden) return undefined;
    if (component.type !== FormItemType.Input && component.type !== FormItemType.Password) {
        return undefined;
    }

    const isPasswordField = component.type === FormItemType.Password;

    const handleChange = (newValue: string) => {
        options?.onChange?.(newValue);
        if (context) {
            context.formAction({
                propertyName: component.propertyName,
                isAction: false,
                value: newValue,
                updateValidation: true,
            });
        }
    };

    const handleBlur = (currentValue: string) => {
        if (context) {
            context.formAction({
                propertyName: component.propertyName,
                isAction: false,
                value: currentValue,
                updateValidation: true,
            });
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
                type={isPasswordField ? (options?.showPassword ? "text" : "password") : "text"}
                value={value}
                placeholder={component.placeholder ?? ""}
                required={component.required}
                readOnly={options?.readOnly}
                onChange={(_, data) => handleChange(data.value)}
                onBlur={(e) => handleBlur(e.target.value)}
                contentAfter={
                    options?.contentAfter ? (
                        options.contentAfter
                    ) : isPasswordField && options?.onTogglePassword ? (
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

// Generic Dropdown Field - automatically handles formAction
export function renderDropdown(
    component: PublishDialogFormItemSpec | undefined,
    value: string | undefined,
    context: PublishProjectContextProps | undefined,
    options?: {
        validateOnChange?: boolean;
    },
) {
    if (!component || component.hidden) return undefined;
    if (component.type !== FormItemType.Dropdown || !component.options) return undefined;

    const handleChange = (newValue: string) => {
        if (context) {
            context.formAction({
                propertyName: component.propertyName,
                isAction: false,
                value: newValue,
                updateValidation: options?.validateOnChange ?? false,
            });
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
            <Dropdown
                size="small"
                selectedOptions={value ? [value] : []}
                value={
                    component.options.find(
                        (o: { value: string; displayName: string }) => o.value === value,
                    )?.displayName || ""
                }
                placeholder={component.placeholder ?? ""}
                onOptionSelect={(_, data) => {
                    if (data.optionValue) {
                        handleChange(data.optionValue);
                    }
                }}
                aria-label={component.label}>
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

// Generic Searchable Dropdown Field - uses SearchableDropdown component with built-in search,
// virtualized list, and keyboard navigation.
export function renderSearchableDropdown(
    component: PublishDialogFormItemSpec | undefined,
    selectedValue: string | undefined,
    onSelect: (value: string) => void,
    options?: {
        disabled?: boolean;
        clearable?: boolean;
        searchBoxPlaceholder?: string;
    },
) {
    if (!component || component.hidden) return undefined;
    if (!component.options) return undefined;

    // Map component options to SearchableDropdownOptions format
    const dropdownOptions: SearchableDropdownOptions[] = component.options.map(
        (opt: { value: string; displayName: string }) => ({
            value: opt.value,
            text: opt.displayName,
        }),
    );

    // Find the currently selected option
    const selectedOption = dropdownOptions.find((opt) => opt.value === selectedValue);

    return (
        <Field
            key={component.propertyName}
            required={component.required}
            label={component.label}
            validationMessage={component.validation?.validationMessage}
            validationState={getValidationState(component.validation)}
            orientation="horizontal">
            <SearchableDropdown
                id={component.propertyName}
                size="small"
                options={dropdownOptions}
                selectedOption={selectedOption}
                placeholder={component.placeholder ?? ""}
                searchBoxPlaceholder={options?.searchBoxPlaceholder}
                disabled={options?.disabled}
                clearable={options?.clearable}
                onSelect={(option) => onSelect(option.value)}
                style={{ width: "100%" }}
            />
        </Field>
    );
}

// Generic Combobox Field - can be used for editable dropdowns (allows custom text input)
// Intended for dropdown-like components where user can type to filter or enter custom values
export function renderCombobox(
    component: PublishDialogFormItemSpec | undefined,
    value: string | undefined,
    freeform: boolean | undefined,
    onChange: (value: string) => void,
    disabled?: boolean,
    onOptionSelect?: (value: string) => void,
    selectedOptionValue?: string,
) {
    if (!component || component.hidden) return undefined;
    if (!freeform && !component.options) return undefined;

    return (
        <Field
            key={component.propertyName}
            required={component.required}
            label={component.label}
            validationMessage={component.validation?.validationMessage}
            validationState={getValidationState(component.validation)}
            orientation="horizontal">
            <Combobox
                size="small"
                freeform={freeform || false}
                value={value || ""}
                selectedOptions={selectedOptionValue ? [selectedOptionValue] : []}
                placeholder={component.placeholder ?? ""}
                disabled={disabled}
                onOptionSelect={(_, data) => {
                    if (data.optionValue) {
                        if (onOptionSelect) {
                            onOptionSelect(data.optionValue);
                        } else {
                            onChange(data.optionValue);
                        }
                    }
                }}
                onChange={(event) => {
                    // Allow custom text input (for freeform mode or filtering)
                    onChange(event.currentTarget.value);
                }}>
                {component.options?.map(
                    (
                        opt: {
                            value: string;
                            displayName: string;
                            color?: string;
                            disabled?: boolean;
                        },
                        i: number,
                    ) => (
                        <Option
                            key={opt.value + i}
                            value={opt.value}
                            text={opt.displayName}
                            disabled={opt.disabled}>
                            {opt.displayName}
                        </Option>
                    ),
                )}
            </Combobox>
        </Field>
    );
}

// Generic Checkbox Field - automatically handles formAction
export function renderCheckbox(
    component: PublishDialogFormItemSpec | undefined,
    checked: boolean,
    context: PublishProjectContextProps | undefined,
    options?: {
        validateOnChange?: boolean;
        label?: React.ReactNode;
    },
) {
    if (!component || component.hidden) return undefined;

    const handleChange = (newChecked: boolean) => {
        if (context) {
            context.formAction({
                propertyName: component.propertyName,
                isAction: false,
                value: newChecked,
                updateValidation: options?.validateOnChange ?? false,
            });
        }
    };

    // Use provided label, or fall back to component.label
    // If component.label is a string, render it with dangerouslySetInnerHTML to support HTML
    const labelContent =
        options?.label ??
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
                    size="medium"
                    checked={checked}
                    onChange={(_, data) => handleChange(data.checked === true)}
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
