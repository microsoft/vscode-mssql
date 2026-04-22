/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Checkbox,
    Combobox,
    Dropdown,
    Field,
    FieldProps,
    InfoLabel,
    Input,
    Label,
    LabelProps,
    Option,
    Spinner,
    Text,
    Textarea,
    Tooltip,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { Eye16Regular, EyeOff16Regular, Info16Regular } from "@fluentui/react-icons";
import {
    FormContextProps,
    FormItemSpec,
    FormItemType,
    FormState,
} from "../../../sharedInterfaces/form";
import { useEffect, useState } from "react";
import { FluentOptionIcons, SearchableDropdown } from "../searchableDropdown.component";
import { locConstants } from "../locConstants";
import { EventType, KeyCode } from "../keys";

export const useFormStyles = makeStyles({
    formRoot: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
    },
    formDiv: {
        padding: "10px",
        maxWidth: "650px",
        display: "flex",
        flexDirection: "column",
        "> *": {
            margin: "5px",
        },
    },
    formComponentDiv: {
        "> *": {
            margin: "5px",
        },
    },
    formComponentActionDiv: {
        display: "flex",
        flexDirection: "row",
        "> *": {
            margin: "5px",
        },
    },
    formNavTrayButton: {
        width: "150px",
        alignSelf: "center",
        margin: "0px 10px",
    },
    formNavTray: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "10px 0px",
    },
    formNavTrayRight: {
        display: "flex",
        marginLeft: "auto",
    },
    labelDecoration: {
        display: "inline-flex",
        alignItems: "center",
        columnGap: "0px",
    },
});

export const FormInput = <
    TForm,
    TState extends FormState<TForm, TState, TFormItemSpec>,
    TFormItemSpec extends FormItemSpec<TForm, TState, TFormItemSpec>,
    TContext extends FormContextProps<TForm>,
>({
    context,
    formState: _formState,
    value,
    target,
    type,
    placeholder,
    props,
}: {
    context: TContext;
    formState: TForm;
    value: string;
    target: keyof TForm;
    type: "input" | "password" | "textarea";
    placeholder: string;
    props?: any;
}) => {
    const [formInputValue, setFormInputValue] = useState(value);
    const [showPassword, setShowPassword] = useState(false);

    useEffect(() => {
        setFormInputValue(value);
    }, [value]);

    const handleChange = (data: string) => {
        setFormInputValue(data);
        context?.formAction({
            propertyName: target,
            isAction: false,
            value: data,
            updateValidation: false,
        });
    };

    const handleBlur = () => {
        context?.formAction({
            propertyName: target,
            isAction: false,
            value: formInputValue,
            updateValidation: true,
        });
    };

    return (
        <>
            {type === "input" && (
                <Input
                    value={formInputValue}
                    onChange={(_value, data) => handleChange(data.value)}
                    onBlur={handleBlur}
                    size="small"
                    placeholder={placeholder}
                    {...props}
                />
            )}
            {type === "password" && (
                <Input
                    type={showPassword ? "text" : "password"}
                    value={formInputValue}
                    onChange={(_value, data) => handleChange(data.value)}
                    onBlur={handleBlur}
                    placeholder={placeholder}
                    size="small"
                    contentAfter={
                        <Button
                            onClick={() => setShowPassword(!showPassword)}
                            icon={showPassword ? <Eye16Regular /> : <EyeOff16Regular />}
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
                            }></Button>
                    }
                    {...props}
                />
            )}
            {type === "textarea" && (
                <Textarea
                    value={formInputValue}
                    size="small"
                    onChange={(_value, data) => handleChange(data.value)}
                    onBlur={handleBlur}
                    {...props}
                />
            )}
        </>
    );
};

export const FormField = <
    TForm,
    TState extends FormState<TForm, TState, TFormItemSpec>,
    TFormItemSpec extends FormItemSpec<TForm, TState, TFormItemSpec>,
    TContext extends FormContextProps<TForm>,
>({
    context,
    formState,
    component,
    idx,
    props,
    componentProps,
}: {
    context: TContext;
    formState: TForm;
    component: TFormItemSpec;
    idx: number;
    props?: FieldProps;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    componentProps?: any; // any because we don't know what the component will be
}) => {
    if (!component) {
        console.error("Form component is undefined");
        return undefined;
    }

    const formStyles = useFormStyles();

    return (
        <div className={formStyles.formComponentDiv} key={idx}>
            <Field
                validationMessage={component.validation?.validationMessage ?? ""}
                orientation={component.type === FormItemType.Checkbox ? "horizontal" : "vertical"}
                validationState={
                    component.validation
                        ? component.validation.isValid
                            ? "none"
                            : "error"
                        : "none"
                }
                required={component.required}
                // @ts-ignore there's a bug in the typings somewhere, so ignoring this line to avoid angering type-checker
                label={{
                    // The html here shouldn't need to be sanitized, and should be safe
                    // because it's only ever set by forms internal to the extension
                    children: (_: unknown, slotProps: LabelProps) => {
                        const labelContent = (
                            <span
                                dangerouslySetInnerHTML={{
                                    __html: component.label,
                                }}
                            />
                        );
                        const LabelComponent = component.tooltip ? InfoLabel : Label;
                        const tooltipProps = component.tooltip ? { info: component.tooltip } : {};
                        return (
                            <span className={formStyles.labelDecoration}>
                                <LabelComponent {...slotProps} {...tooltipProps}>
                                    {labelContent}
                                </LabelComponent>
                                {component.loading && <Spinner size="extra-tiny" />}
                            </span>
                        );
                    },
                }}
                {...props}
                style={{ color: tokens.colorNeutralForeground1 }}>
                {generateFormComponent<TForm, TState, TFormItemSpec, TContext>(
                    context,
                    formState,
                    component,
                    componentProps,
                )}
            </Field>
            {component?.actionButtons?.length! > 0 && (
                <div className={formStyles.formComponentActionDiv}>
                    {component.actionButtons?.map((actionButton, idx) => {
                        return (
                            <Button
                                key={idx + actionButton.id}
                                style={{ width: "auto", whiteSpace: "nowrap" }}
                                onClick={() =>
                                    context?.formAction({
                                        propertyName: component.propertyName,
                                        isAction: true,
                                        value: actionButton.id,
                                    })
                                }>
                                {actionButton.label}
                            </Button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export function generateFormComponent<
    TForm,
    TState extends FormState<TForm, TState, TFormItemSpec>,
    TFormItemSpec extends FormItemSpec<TForm, TState, TFormItemSpec>,
    TContext extends FormContextProps<TForm>,
>(context: TContext, formState: TForm, component: TFormItemSpec, props?: any) {
    switch (component.type) {
        case FormItemType.Input:
            return (
                <FormInput<TForm, TState, TFormItemSpec, TContext>
                    context={context}
                    formState={formState}
                    value={(formState[component.propertyName] as string) ?? ""}
                    target={component.propertyName}
                    type="input"
                    placeholder={component.placeholder ?? ""}
                    props={props}
                />
            );
        case FormItemType.TextArea:
            return (
                <FormInput<TForm, TState, TFormItemSpec, TContext>
                    context={context}
                    formState={formState}
                    value={(formState[component.propertyName] as string) ?? ""}
                    target={component.propertyName}
                    type="textarea"
                    placeholder={component.placeholder ?? ""}
                    props={props}
                />
            );
        case FormItemType.Password:
            return (
                <FormInput<TForm, TState, TFormItemSpec, TContext>
                    context={context}
                    formState={formState}
                    value={(formState[component.propertyName] as string) ?? ""}
                    target={component.propertyName}
                    placeholder={component.placeholder ?? ""}
                    type="password"
                    props={props}
                />
            );
        case FormItemType.Dropdown:
            if (component.options === undefined) {
                throw new Error("Dropdown component must have options");
            }
            return (
                <Dropdown
                    size="small"
                    placeholder={component.placeholder ?? ""}
                    value={
                        component.options.find(
                            (option) => option.value === formState[component.propertyName],
                        )?.displayName ?? ""
                    }
                    selectedOptions={[formState[component.propertyName] as string]}
                    onOptionSelect={(event, data) => {
                        if (props && props.onOptionSelect) {
                            props.onOptionSelect(event, data);
                        } else {
                            context?.formAction({
                                propertyName: component.propertyName,
                                isAction: false,
                                value: data.optionValue as string,
                            });
                        }
                    }}
                    {...props}>
                    {component.options?.map((option, idx) => {
                        return (
                            <Option
                                key={(component.propertyName as string) + idx}
                                value={option.value}
                                text={option.displayName}>
                                <div
                                    style={{
                                        width: "100%",
                                        display: "flex",
                                        flexDirection: "row",
                                        justifyContent: "space-between",
                                        ...(option.color
                                            ? { color: tokens[option.color as keyof typeof tokens] }
                                            : {}),
                                    }}>
                                    {option.displayName}
                                    <span
                                        style={{
                                            display: "flex",
                                            gap: "4px",
                                            marginRight: "12px",
                                        }}>
                                        {option.description && <Text>{option.description}</Text>}
                                        {option.icon && FluentOptionIcons[option.icon]}
                                        {option.infoTooltip && (
                                            <span
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    e.preventDefault();
                                                    context?.openInfoLink?.(option);
                                                }}
                                                style={{ display: "flex", alignItems: "center" }}>
                                                <Tooltip
                                                    content={option.infoTooltip}
                                                    relationship="description"
                                                    positioning="after"
                                                    withArrow>
                                                    <button
                                                        type="button"
                                                        aria-label={locConstants.common.learnMore}
                                                        style={{
                                                            background: "none",
                                                            border: "none",
                                                            cursor: "pointer",
                                                            padding: 0,
                                                            minWidth: 0,
                                                            display: "flex",
                                                            alignItems: "center",
                                                            color: "inherit",
                                                        }}>
                                                        <Info16Regular />
                                                    </button>
                                                </Tooltip>
                                            </span>
                                        )}
                                    </span>
                                </div>
                            </Option>
                        );
                    })}
                </Dropdown>
            );
        case FormItemType.Combobox:
            if (component.options === undefined) {
                throw new Error("Combobox component must have options");
            }
            // options that sets whether a user can enter a freeform value or must select from the list of options
            const isFreeform = props && props.freeform;
            const optionDisplayName =
                component.options.find(
                    (option) => option.value === formState[component.propertyName],
                )?.displayName ?? "";
            return (
                <Combobox
                    size="small"
                    placeholder={component.placeholder ?? ""}
                    value={
                        isFreeform
                            ? (formState[component.propertyName] as string)
                            : optionDisplayName
                    }
                    selectedOptions={
                        optionDisplayName !== ""
                            ? [formState[component.propertyName] as string]
                            : []
                    }
                    autoComplete={isFreeform ? "off" : "on"}
                    onChange={(event) => {
                        if (isFreeform) {
                            if (props.onChange) {
                                props.onChange(event);
                            } else {
                                context?.formAction({
                                    propertyName: component.propertyName,
                                    isAction: false,
                                    value: event.target.value,
                                });
                            }
                        }
                    }}
                    onOptionSelect={(event, data) => {
                        // if user pressed enter after typing a freeform value that doesn't match an option,
                        // don't trigger onOptionSelect and instead let onChange handle it
                        if (
                            isFreeform &&
                            !optionDisplayName &&
                            event.type === EventType.Keydown &&
                            (event as React.KeyboardEvent).key === KeyCode.Enter
                        ) {
                            return;
                        }
                        if (props && props.onOptionSelect) {
                            props.onOptionSelect(event, data);
                        } else {
                            context?.formAction({
                                propertyName: component.propertyName,
                                isAction: false,
                                value: data.optionValue as string,
                            });
                        }
                    }}
                    {...props}>
                    {component.options.map((option) => (
                        <Option key={option.value} value={option.value}>
                            {option.displayName}
                        </Option>
                    ))}
                </Combobox>
            );
        case FormItemType.SearchableDropdown:
            if (component.options === undefined) {
                throw new Error("Dropdown component must have options");
            }
            const dropdownOptions = component.options.map((opt) => ({
                value: opt.value,
                text: opt.displayName,
                color: opt.color,
                description: opt.description,
                icon: opt.icon,
            }));
            const selectedOption = dropdownOptions.find(
                (option) => option.value === formState[component.propertyName],
            );
            return (
                <SearchableDropdown
                    options={dropdownOptions}
                    placeholder={component.placeholder}
                    searchBoxPlaceholder={component.searchBoxPlaceholder}
                    selectedOption={selectedOption}
                    onSelect={(option) => {
                        if (props && props.onSelect) {
                            props.onSelect(option.value);
                        } else {
                            context?.formAction({
                                propertyName: component.propertyName,
                                isAction: false,
                                value: option.value,
                            });
                        }
                    }}
                    size="small"
                    clearable={true}
                    ariaLabel={component.label}
                    {...props}
                />
            );
        case FormItemType.Checkbox:
            return (
                <Checkbox
                    size="medium"
                    checked={(formState[component.propertyName] as boolean) ?? false}
                    onChange={(_value, data) =>
                        context?.formAction({
                            propertyName: component.propertyName,
                            isAction: false,
                            value: data.checked,
                        })
                    }
                    {...props}
                />
            );
    }
}
