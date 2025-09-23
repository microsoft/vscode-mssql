/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect } from "react";
import { makeStyles, Checkbox, tokens, CheckboxOnChangeData } from "@fluentui/react-components";
import { PublishProjectContext } from "../publishProjectStateProvider";
import { usePublishDialogSelector } from "../publishDialogSelector";
import {
    IPublishForm,
    PublishDialogState,
    PublishDialogFormItemSpec,
} from "../../../../sharedInterfaces/publishDialog";
import { FormField } from "../../../common/forms/form.component";
import { PublishFormContext } from "../types";
import * as constants from "../../../../constants/constants";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        maxWidth: "640px",
        width: "100%",
    },
    containerGroup: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        paddingLeft: "16px",
        borderLeft: "2px solid var(--vscode-editorWidget-border, #8883)",
    },
    licenseBlock: {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        maxWidth: "100%",
    },
    licenseLabel: {
        lineHeight: "1.3",
    },
});

const containerFieldOrder: (keyof IPublishForm)[] = [
    constants.PublishFormFields.ContainerPort,
    constants.PublishFormFields.ContainerAdminPassword,
    constants.PublishFormFields.ContainerAdminPasswordConfirm,
    constants.PublishFormFields.ContainerImageTag,
    constants.PublishFormFields.AcceptContainerLicense,
] as (keyof IPublishForm)[];

export const PublishTargetSection: React.FC<{ idx: number }> = ({ idx }) => {
    const classes = useStyles();
    const context = useContext(PublishProjectContext) as PublishFormContext | undefined;

    // Select just the publishTarget FormItemSpec
    const targetSpec = usePublishDialogSelector(
        (s) =>
            s.formComponents[constants.PublishFormFields.PublishTarget] as
                | PublishDialogFormItemSpec
                | undefined,
        Object.is,
    );

    // Select the current target value
    const publishTargetValue = usePublishDialogSelector(
        (s) => s.formState[constants.PublishFormFields.PublishTarget],
        (a, b) => a === b,
    );

    if (!context || !targetSpec || targetSpec.hidden) {
        return undefined;
    }

    const isContainer = publishTargetValue === constants.PublishTargets.LOCAL_CONTAINER;

    useEffect(() => {
        if (!isContainer) {
            return;
        }

        // Set default port once when entering container mode
        if (!context.state.formState.containerPort) {
            context.formAction({
                propertyName: constants.PublishFormFields.ContainerPort,
                isAction: false,
                value: constants.DefaultSqlPortNumber,
            });
        }

        // Set default image tag if none selected
        if (!context.state.formState.containerImageTag) {
            context.formAction({
                propertyName: constants.PublishFormFields.ContainerImageTag,
                isAction: false,
                value: constants.dockerImageDefaultTag,
            });
        }
    }, [isContainer, context]);

    return (
        <div className={classes.root}>
            <FormField<
                IPublishForm,
                PublishDialogState,
                PublishDialogFormItemSpec,
                PublishFormContext
            >
                context={context}
                component={targetSpec}
                idx={idx}
                props={{ orientation: "horizontal" }}
            />

            {isContainer && (
                <div className={classes.containerGroup}>
                    {containerFieldOrder.map((name, cIdx) => {
                        const comp = context.state.formComponents[name] as
                            | PublishDialogFormItemSpec
                            | undefined;

                        if (!comp || comp.hidden) {
                            return undefined;
                        }

                        // License checkbox special rendering
                        if (name === constants.PublishFormFields.AcceptContainerLicense) {
                            const isChecked =
                                (context.state.formState[
                                    comp.propertyName as keyof IPublishForm
                                ] as boolean) ?? false;

                            // License checkbox is required - show error only if validation has been attempted
                            const validation = comp.validation;
                            const isError = validation !== undefined && !validation.isValid;
                            const errorMessage = isError ? validation.validationMessage : undefined;

                            const licenseLabel = (
                                <span
                                    className={classes.licenseLabel}
                                    dangerouslySetInnerHTML={{ __html: comp.label ?? "" }}
                                />
                            );

                            return (
                                <div key={String(name)} className={classes.licenseBlock}>
                                    <Checkbox
                                        size="medium"
                                        label={licenseLabel}
                                        required={true}
                                        checked={isChecked}
                                        onChange={(
                                            _: React.ChangeEvent<HTMLInputElement>,
                                            data: CheckboxOnChangeData,
                                        ) => {
                                            const isChecked = data.checked === true;
                                            context.formAction({
                                                propertyName: comp.propertyName,
                                                isAction: false,
                                                value: isChecked,
                                            });
                                        }}
                                        style={{ alignItems: "flex-start" }}
                                    />
                                    {isError && errorMessage && (
                                        <span
                                            style={{
                                                color: tokens.colorStatusDangerForeground1,
                                                fontSize: 12,
                                            }}>
                                            {errorMessage}
                                        </span>
                                    )}
                                </div>
                            );
                        }

                        return (
                            <FormField<
                                IPublishForm,
                                PublishDialogState,
                                PublishDialogFormItemSpec,
                                PublishFormContext
                            >
                                key={String(name)}
                                context={context}
                                component={comp}
                                idx={idx + cIdx + 1}
                                props={{ orientation: "horizontal" }}
                            />
                        );
                    })}
                </div>
            )}
        </div>
    );
};
