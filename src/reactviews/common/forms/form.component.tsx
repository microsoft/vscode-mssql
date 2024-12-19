/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Checkbox,
    Dropdown,
    Field,
    FieldProps,
    InfoLabel,
    Input,
    LabelProps,
    Option,
    Textarea,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { EyeOffRegular, EyeRegular } from "@fluentui/react-icons";
import {
    FormContextProps,
    FormItemSpec,
    FormItemType,
    FormState,
} from "./form";
import { useEffect, useState } from "react";

export const FormInput = <
    TContext extends FormContextProps<TState, TForm>,
    TState extends FormState<TForm>,
    TForm,
>({
    context,
    value,
    target,
    type,
    props,
}: {
    context: TContext;
    value: string;
    target: keyof TForm;
    type: "input" | "password" | "textarea";
    props?: any;
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
                    {...props}
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
    TContext extends FormContextProps<TState, TForm>,
    TState extends FormState<TForm>,
    TForm,
>({
    context,
    component,
    idx,
    props,
    componentProps,
}: {
    context: TContext;
    component: FormItemSpec<TState, TForm>;
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
                style={{ color: tokens.colorNeutralForeground1 }}
            >
                {generateFormComponent(context, component, componentProps)}
            </Field>
            {component?.actionButtons?.length! > 0 && (
                <div className={formStyles.formComponentActionDiv}>
                    {component.actionButtons?.map((actionButton, idx) => {
                        return (
                            <Button
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
>(context: TContext, component: FormItemSpec<TState, TForm>, props?: any) {
    const formState = context.state.formState;

    switch (component.type) {
        case FormItemType.Input:
            return (
                <FormInput<TContext, TState, TForm>
                    context={context}
                    value={(formState[component.propertyName] as string) ?? ""}
                    target={component.propertyName}
                    type="input"
                    props={props}
                />
            );
        case FormItemType.TextArea:
            return (
                <FormInput<TContext, TState, TForm>
                    context={context}
                    value={(formState[component.propertyName] as string) ?? ""}
                    target={component.propertyName}
                    type="textarea"
                    props={props}
                />
            );
        case FormItemType.Password:
            return (
                <FormInput<TContext, TState, TForm>
                    context={context}
                    value={(formState[component.propertyName] as string) ?? ""}
                    target={component.propertyName}
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
                    {...props}
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
                    {...props}
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
});
