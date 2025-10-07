/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import { makeStyles } from "@fluentui/react-components";
import { PublishProjectContext } from "../publishProjectStateProvider";
import { usePublishDialogSelector } from "../publishDialogSelector";
import * as constants from "../../../../constants/constants";
import { renderInput, renderDropdown, CheckboxField } from "./FormFieldComponents";
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

    // Password visibility state management
    const [showAdminPassword, setShowAdminPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

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

    return (
        <div className={classes.root}>
            {/* Publish Target Dropdown */}
            {renderDropdown(
                targetComponent,
                targetValue,
                (val: string) => {
                    publishCtx.formAction({
                        propertyName: targetComponent.propertyName,
                        isAction: false,
                        value: val,
                    });
                },
                publishCtx,
            )}

            {/* Container Fields - Shown only when local container is selected */}
            {isContainer && (
                <div className={classes.containerGroup}>
                    {/* Container Port */}
                    {renderInput(
                        portComponent,
                        portValue?.toString() || "",
                        (val: string) => {
                            if (portComponent) {
                                publishCtx.formAction({
                                    propertyName: portComponent.propertyName,
                                    isAction: false,
                                    value: val,
                                    updateValidation: false,
                                });
                            }
                        },
                        publishCtx,
                        {
                            onBlur: (val: string) => {
                                if (portComponent) {
                                    publishCtx.formAction({
                                        propertyName: portComponent.propertyName,
                                        isAction: false,
                                        value: val,
                                        updateValidation: true,
                                    });
                                }
                            },
                        },
                    )}

                    {/* Admin Password */}
                    {renderInput(
                        passwordComponent,
                        passwordValue?.toString() || "",
                        (val: string) => {
                            if (passwordComponent) {
                                publishCtx.formAction({
                                    propertyName: passwordComponent.propertyName,
                                    isAction: false,
                                    value: val,
                                    updateValidation: false,
                                });
                            }
                        },
                        publishCtx,
                        {
                            showPassword: showAdminPassword,
                            onTogglePassword: () => setShowAdminPassword(!showAdminPassword),
                            onBlur: (val: string) => {
                                if (passwordComponent) {
                                    publishCtx.formAction({
                                        propertyName: passwordComponent.propertyName,
                                        isAction: false,
                                        value: val,
                                        updateValidation: true,
                                    });
                                }
                            },
                        },
                    )}

                    {/* Confirm Password */}
                    {renderInput(
                        confirmPasswordComponent,
                        confirmPasswordValue?.toString() || "",
                        (val: string) => {
                            if (confirmPasswordComponent) {
                                publishCtx.formAction({
                                    propertyName: confirmPasswordComponent.propertyName,
                                    isAction: false,
                                    value: val,
                                    updateValidation: false,
                                });
                            }
                        },
                        publishCtx,
                        {
                            showPassword: showConfirmPassword,
                            onTogglePassword: () => setShowConfirmPassword(!showConfirmPassword),
                            onBlur: (val: string) => {
                                if (confirmPasswordComponent) {
                                    publishCtx.formAction({
                                        propertyName: confirmPasswordComponent.propertyName,
                                        isAction: false,
                                        value: val,
                                        updateValidation: true,
                                    });
                                }
                            },
                        },
                    )}

                    {/* Container Image Tag */}
                    {renderDropdown(
                        imageTagComponent,
                        imageTagValue?.toString(),
                        (val: string) => {
                            if (imageTagComponent) {
                                publishCtx.formAction({
                                    propertyName: imageTagComponent.propertyName,
                                    isAction: false,
                                    value: val,
                                    updateValidation: true,
                                });
                            }
                        },
                        publishCtx,
                    )}

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
                    />
                </div>
            )}
        </div>
    );
};
