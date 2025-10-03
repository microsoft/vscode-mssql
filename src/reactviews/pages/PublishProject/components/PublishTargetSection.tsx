/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect } from "react";
import { makeStyles } from "@fluentui/react-components";
import { PublishProjectContext } from "../publishProjectStateProvider";
import { usePublishDialogSelector } from "../publishDialogSelector";
import * as constants from "../../../../constants/constants";
import { InputField, DropdownField, CheckboxField } from "./FormFieldComponents";
import { parseHtmlLabel } from "../../../../publishProject/projectUtils";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        maxWidth: "640px",
        width: "100%",
    },
    containerGroup: {
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        paddingLeft: "16px",
        borderLeft: "2px solid var(--vscode-editorWidget-border, #8883)",
    },
});

export const PublishTargetSection: React.FC = () => {
    const classes = useStyles();
    const publishCtx = useContext(PublishProjectContext);

    // Select form components and values - components needed for rendering, values for logic
    const targetComponent = usePublishDialogSelector(
        (s) => s.formComponents[constants.PublishFormFields.PublishTarget],
    );
    const targetValue = usePublishDialogSelector(
        (s) => s.formState[constants.PublishFormFields.PublishTarget],
    );

    const isContainer = targetValue === constants.PublishTargets.LOCAL_CONTAINER;

    // Container-specific fields (only select when needed)
    const portComponent = usePublishDialogSelector(
        (s) => s.formComponents[constants.PublishFormFields.ContainerPort],
    );
    const portValue = usePublishDialogSelector(
        (s) => s.formState[constants.PublishFormFields.ContainerPort],
    );

    const passwordComponent = usePublishDialogSelector(
        (s) => s.formComponents[constants.PublishFormFields.ContainerAdminPassword],
    );
    const passwordValue = usePublishDialogSelector(
        (s) => s.formState[constants.PublishFormFields.ContainerAdminPassword],
    );

    const confirmPasswordComponent = usePublishDialogSelector(
        (s) => s.formComponents[constants.PublishFormFields.ContainerAdminPasswordConfirm],
    );
    const confirmPasswordValue = usePublishDialogSelector(
        (s) => s.formState[constants.PublishFormFields.ContainerAdminPasswordConfirm],
    );

    const imageTagComponent = usePublishDialogSelector(
        (s) => s.formComponents[constants.PublishFormFields.ContainerImageTag],
    );
    const imageTagValue = usePublishDialogSelector(
        (s) => s.formState[constants.PublishFormFields.ContainerImageTag],
    );

    const licenseComponent = usePublishDialogSelector(
        (s) => s.formComponents[constants.PublishFormFields.AcceptContainerLicense],
    );
    const licenseValue = usePublishDialogSelector(
        (s) => s.formState[constants.PublishFormFields.AcceptContainerLicense],
    );

    // Auto-populate defaults and revalidate passwords
    useEffect(() => {
        if (!publishCtx || !isContainer) {
            return;
        }

        // Default container port if not set
        if (!portValue) {
            publishCtx.formAction({
                propertyName: constants.PublishFormFields.ContainerPort,
                isAction: false,
                value: constants.DefaultSqlPortNumber,
                updateValidation: true,
            });
        }

        // Auto-select first image tag if not set
        if (!imageTagValue && imageTagComponent?.options?.[0]) {
            publishCtx.formAction({
                propertyName: constants.PublishFormFields.ContainerImageTag,
                isAction: false,
                value: imageTagComponent.options[0].value,
                updateValidation: true,
            });
        }
    }, [isContainer, portValue, imageTagValue, imageTagComponent, publishCtx]);

    // Revalidate confirm password when primary password changes (not when confirm password changes)
    useEffect(() => {
        if (!publishCtx || !isContainer) {
            return;
        }

        // Only revalidate if confirm password field has a value
        if (confirmPasswordValue !== undefined && confirmPasswordValue !== "") {
            publishCtx.formAction({
                propertyName: constants.PublishFormFields.ContainerAdminPasswordConfirm,
                isAction: false,
                value: confirmPasswordValue as string,
                updateValidation: true,
            });
        }
    }, [isContainer, passwordValue, publishCtx]); // Only depends on passwordValue, NOT confirmPasswordValue

    if (!publishCtx || !targetComponent || targetComponent.hidden) {
        return undefined;
    }

    if (
        targetComponent.type !== "dropdown" ||
        !("options" in targetComponent) ||
        !targetComponent.options
    ) {
        return undefined;
    }

    const getValidationState = (validation: typeof targetComponent.validation) => {
        return validation ? (validation.isValid ? "none" : "error") : "none";
    };

    return (
        <div className={classes.root}>
            {/* Publish Target Dropdown */}
            <DropdownField
                component={targetComponent}
                value={targetValue}
                onChange={(val) => {
                    publishCtx.formAction({
                        propertyName: targetComponent.propertyName,
                        isAction: false,
                        value: val,
                    });
                }}
                getValidationState={getValidationState}
            />

            {/* Container Fields - Shown only when local container is selected */}
            {isContainer && (
                <div className={classes.containerGroup}>
                    {/* Container Port */}
                    <InputField
                        component={portComponent}
                        value={portValue?.toString() || ""}
                        onChange={(val) =>
                            portComponent &&
                            publishCtx.formAction({
                                propertyName: portComponent.propertyName,
                                isAction: false,
                                value: val,
                                updateValidation: false,
                            })
                        }
                        onBlur={(val) =>
                            portComponent &&
                            publishCtx.formAction({
                                propertyName: portComponent.propertyName,
                                isAction: false,
                                value: val,
                                updateValidation: true,
                            })
                        }
                        getValidationState={getValidationState}
                    />

                    {/* Admin Password */}
                    <InputField
                        component={passwordComponent}
                        value={passwordValue?.toString() || ""}
                        type="password"
                        onChange={(val) =>
                            passwordComponent &&
                            publishCtx.formAction({
                                propertyName: passwordComponent.propertyName,
                                isAction: false,
                                value: val,
                                updateValidation: false,
                            })
                        }
                        onBlur={(val) =>
                            passwordComponent &&
                            publishCtx.formAction({
                                propertyName: passwordComponent.propertyName,
                                isAction: false,
                                value: val,
                                updateValidation: true,
                            })
                        }
                        getValidationState={getValidationState}
                    />

                    {/* Confirm Password */}
                    <InputField
                        component={confirmPasswordComponent}
                        value={confirmPasswordValue?.toString() || ""}
                        type="password"
                        onChange={(val) =>
                            confirmPasswordComponent &&
                            publishCtx.formAction({
                                propertyName: confirmPasswordComponent.propertyName,
                                isAction: false,
                                value: val,
                                updateValidation: false,
                            })
                        }
                        onBlur={(val) =>
                            confirmPasswordComponent &&
                            publishCtx.formAction({
                                propertyName: confirmPasswordComponent.propertyName,
                                isAction: false,
                                value: val,
                                updateValidation: true,
                            })
                        }
                        getValidationState={getValidationState}
                    />

                    {/* Container Image Tag */}
                    <DropdownField
                        component={imageTagComponent}
                        value={imageTagValue?.toString()}
                        onChange={(val) => {
                            imageTagComponent &&
                                publishCtx.formAction({
                                    propertyName: imageTagComponent.propertyName,
                                    isAction: false,
                                    value: val,
                                    updateValidation: true,
                                });
                        }}
                        getValidationState={getValidationState}
                    />

                    {/* Accept License Checkbox */}
                    <CheckboxField
                        component={licenseComponent}
                        checked={Boolean(licenseValue)}
                        label={
                            licenseComponent?.label ? (
                                <>
                                    {parseHtmlLabel(licenseComponent.label)?.parts.map((part, i) =>
                                        typeof part === "string" ? (
                                            part
                                        ) : (
                                            <a
                                                key={i}
                                                href={part.href}
                                                target="_blank"
                                                rel="noopener noreferrer">
                                                {part.text}
                                            </a>
                                        ),
                                    )}
                                </>
                            ) : undefined
                        }
                        onChange={(checked) => {
                            licenseComponent &&
                                publishCtx.formAction({
                                    propertyName: licenseComponent.propertyName,
                                    isAction: false,
                                    value: checked,
                                    updateValidation: true,
                                });
                        }}
                        getValidationState={getValidationState}
                    />
                </div>
            )}
        </div>
    );
};
