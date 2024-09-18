/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from "react";
import {
    Input,
    Button,
    Textarea,
    makeStyles,
    Field,
    InfoLabel,
    LabelProps,
    Dropdown,
    Checkbox,
    Option,
    FieldProps,
} from "@fluentui/react-components";
import { EyeRegular, EyeOffRegular } from "@fluentui/react-icons";
import {
    FormItemSpec,
    FormItemType,
    FormContextProps,
    FormState,
} from "./form";

export const FormInput = <
    TContext extends FormContextProps<TState, TForm>,
    TState extends FormState<TForm>,
    TForm,
>({
    context,
    value,
    target,
    type,
}: {
    context: TContext;
    value: string;
    target: keyof TForm;
    type: "input" | "password" | "textarea";
}) => {
    const [formInputValue, setFormInputValue] = useState(value);
    const [showPassword, setShowPassword] = useState(false);

    useEffect(() => {
        setFormInputValue(value);
    }, [value]);

    const handleChange = (data: string) => {
        setFormInputValue(data);
    };

    const handleBlur = () => {
        context?.formAction({
            propertyName: target,
            isAction: false,
            value: formInputValue,
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
                />
            )}
            {type === "password" && (
                <Input
                    type={showPassword ? "text" : "password"}
                    value={formInputValue}
                    onChange={(_value, data) => handleChange(data.value)}
                    onBlur={handleBlur}
                    size="small"
                    contentAfter={
                        <Button
                            onClick={() => setShowPassword(!showPassword)}
                            icon={
                                showPassword ? (
                                    <EyeRegular />
                                ) : (
                                    <EyeOffRegular />
                                )
                            }
                            appearance="transparent"
                            size="small"
                        ></Button>
                    }
                />
            )}
            {type === "textarea" && (
                <Textarea
                    value={formInputValue}
                    size="small"
                    onChange={(_value, data) => handleChange(data.value)}
                    onBlur={handleBlur}
                />
            )}
        </>
    );
};

export const FormField = <
    TContext extends FormContextProps<TState, TForm>,
    TState extends FormState<TForm>,
    TForm,
>({
    context,
    component,
    idx,
    props,
}: {
    context: TContext;
    component: FormItemSpec<TForm>;
    idx: number;
    props?: FieldProps;
}) => {
    if (!component) {
        console.error("Form component is undefined");
        return undefined;
    }

    const formStyles = useFormStyles();

    return (
        <div className={formStyles.formComponentDiv} key={idx}>
            <Field
                validationMessage={
                    component.validation?.validationMessage ?? ""
                }
                orientation={
                    component.type === FormItemType.Checkbox
                        ? "horizontal"
                        : "vertical"
                }
                validationState={
                    component.validation
                        ? component.validation.isValid
                            ? "none"
                            : "error"
                        : "none"
                }
                required={component.required}
                // @ts-ignore there's a bug in the typings somewhere, so ignoring this line to avoid angering type-checker
                label={
                    component.tooltip
                        ? {
                              children: (_: unknown, slotProps: LabelProps) => (
                                  <InfoLabel
                                      {...slotProps}
                                      info={component.tooltip}
                                  >
                                      {component.label}
                                  </InfoLabel>
                              ),
                          }
                        : component.label
                }
                {...props}
                style={{ color: context.theme.colorNeutralForeground1 }}
            >
                {generateFormComponent(context, component, idx)}
            </Field>
            {component?.actionButtons?.length! > 0 && (
                <div className={formStyles.formComponentActionDiv}>
                    {component.actionButtons?.map((actionButton, idx) => {
                        return (
                            <Button
                                shape="square"
                                key={idx + actionButton.id}
                                appearance="outline"
                                style={{
                                    width: "120px",
                                }}
                                onClick={() =>
                                    context?.formAction({
                                        propertyName: component.propertyName,
                                        isAction: true,
                                        value: actionButton.id,
                                    })
                                }
                            >
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
    TContext extends FormContextProps<TState, TForm>,
    TState extends FormState<TForm>,
    TForm,
>(context: TContext, component: FormItemSpec<TForm>, _idx: number) {
    const formState = context.state.formState;

    switch (component.type) {
        case FormItemType.Input:
            return (
                <FormInput<TContext, TState, TForm>
                    context={context}
                    value={(formState[component.propertyName] as string) ?? ""}
                    target={component.propertyName}
                    type="input"
                />
            );
        case FormItemType.TextArea:
            return (
                <FormInput<TContext, TState, TForm>
                    context={context}
                    value={(formState[component.propertyName] as string) ?? ""}
                    target={component.propertyName}
                    type="textarea"
                />
            );
        case FormItemType.Password:
            return (
                <FormInput<TContext, TState, TForm>
                    context={context}
                    value={(formState[component.propertyName] as string) ?? ""}
                    target={component.propertyName}
                    type="password"
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
                            (option) =>
                                option.value ===
                                formState[component.propertyName],
                        )?.displayName ?? ""
                    }
                    selectedOptions={[
                        formState[component.propertyName] as string,
                    ]}
                    onOptionSelect={(_event, data) => {
                        context?.formAction({
                            propertyName: component.propertyName,
                            isAction: false,
                            value: data.optionValue as string,
                        });
                    }}
                >
                    {component.options?.map((option, idx) => {
                        return (
                            <Option
                                key={(component.propertyName as string) + idx}
                                value={option.value}
                            >
                                {option.displayName}
                            </Option>
                        );
                    })}
                </Dropdown>
            );
        case FormItemType.Checkbox:
            return (
                <Checkbox
                    size="medium"
                    checked={
                        (formState[component.propertyName] as boolean) ?? false
                    }
                    onChange={(_value, data) =>
                        context?.formAction({
                            propertyName: component.propertyName,
                            isAction: false,
                            value: data.checked,
                        })
                    }
                />
            );
    }
}

export const useFormStyles = makeStyles({
    formRoot: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
    },
    formDiv: {
        padding: "10px",
        maxWidth: "600px",
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
});
