/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect } from "react";
import { makeStyles } from "@fluentui/react-components";
import { PublishProjectContext } from "../publishProjectStateProvider";
import { usePublishDialogSelector } from "../publishDialogSelector";
import {
    PublishTarget,
    PublishFormFields,
    DefaultSqlPortNumber,
} from "../../../../sharedInterfaces/publishDialog";
import { renderDropdown, renderCheckbox, InputField } from "./FormFieldComponents";

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
    const styles = useStyles();
    const publishCtx = useContext(PublishProjectContext);

    // Select form components and values - components needed for rendering, values for logic
    const targetComponent = usePublishDialogSelector(
        (s) => s.formComponents[PublishFormFields.PublishTarget],
    );
    const targetValue = usePublishDialogSelector(
        (s) => s.formState[PublishFormFields.PublishTarget],
    );

    const isContainer = targetValue === PublishTarget.LocalContainer;

    // Container-specific fields (only select when needed)
    const portComponent = usePublishDialogSelector(
        (s) => s.formComponents[PublishFormFields.ContainerPort],
    );
    const portValue = usePublishDialogSelector((s) => s.formState[PublishFormFields.ContainerPort]);

    const passwordComponent = usePublishDialogSelector(
        (s) => s.formComponents[PublishFormFields.ContainerAdminPassword],
    );
    const passwordValue = usePublishDialogSelector(
        (s) => s.formState[PublishFormFields.ContainerAdminPassword],
    );

    const confirmPasswordComponent = usePublishDialogSelector(
        (s) => s.formComponents[PublishFormFields.ContainerAdminPasswordConfirm],
    );
    const confirmPasswordValue = usePublishDialogSelector(
        (s) => s.formState[PublishFormFields.ContainerAdminPasswordConfirm],
    );

    const imageTagComponent = usePublishDialogSelector(
        (s) => s.formComponents[PublishFormFields.ContainerImageTag],
    );
    const imageTagValue = usePublishDialogSelector(
        (s) => s.formState[PublishFormFields.ContainerImageTag],
    );

    const licenseComponent = usePublishDialogSelector(
        (s) => s.formComponents[PublishFormFields.AcceptContainerLicense],
    );
    const licenseValue = usePublishDialogSelector(
        (s) => s.formState[PublishFormFields.AcceptContainerLicense],
    );

    // Auto-populate defaults and revalidate passwords
    useEffect(() => {
        if (!publishCtx || !isContainer) {
            return;
        }

        // Default container port if not set
        if (!portValue) {
            publishCtx.formAction({
                propertyName: PublishFormFields.ContainerPort,
                isAction: false,
                value: DefaultSqlPortNumber,
                updateValidation: true,
            });
        }

        // Auto-select first image tag if not set
        if (!imageTagValue && imageTagComponent?.options?.[0]) {
            publishCtx.formAction({
                propertyName: PublishFormFields.ContainerImageTag,
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
                propertyName: PublishFormFields.ContainerAdminPasswordConfirm,
                isAction: false,
                value: confirmPasswordValue as string,
                updateValidation: true,
            });
        }
    }, [isContainer, passwordValue, publishCtx]);

    if (!publishCtx || !targetComponent) {
        return undefined;
    }

    return (
        <div className={styles.root}>
            {/* Publish Target Dropdown */}
            {renderDropdown(targetComponent, targetValue, (val) => {
                publishCtx.formAction({
                    propertyName: targetComponent.propertyName,
                    isAction: false,
                    value: val,
                });
            })}

            {/* Container Fields - Shown only when local container is selected */}
            {isContainer && (
                <div className={styles.containerGroup}>
                    {/* Container Port */}
                    <InputField
                        context={publishCtx}
                        component={portComponent}
                        value={portValue?.toString() || ""}
                    />

                    {/* Admin Password */}
                    <InputField
                        context={publishCtx}
                        component={passwordComponent}
                        value={passwordValue?.toString() || ""}
                    />

                    {/* Confirm Password */}
                    <InputField
                        context={publishCtx}
                        component={confirmPasswordComponent}
                        value={confirmPasswordValue?.toString() || ""}
                    />

                    {/* Container Image Tag */}
                    {renderDropdown(imageTagComponent, imageTagValue?.toString(), (val) => {
                        imageTagComponent &&
                            publishCtx.formAction({
                                propertyName: imageTagComponent.propertyName,
                                isAction: false,
                                value: val,
                                updateValidation: true,
                            });
                    })}

                    {/* Accept License Checkbox */}
                    {renderCheckbox(licenseComponent, Boolean(licenseValue), (checked) => {
                        licenseComponent &&
                            publishCtx.formAction({
                                propertyName: licenseComponent.propertyName,
                                isAction: false,
                                value: checked,
                                updateValidation: true,
                            });
                    })}
                </div>
            )}
        </div>
    );
};
