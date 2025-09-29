/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect } from "react";
import { makeStyles } from "@fluentui/react-components";
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
    // (License-specific styles removed; using generic FormField rendering now)
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

    // Track password & confirm password values for cross-field validation
    const containerPassword = usePublishDialogSelector(
        (s) => s.formState[constants.PublishFormFields.ContainerAdminPassword],
        (a, b) => a === b,
    );
    const containerPasswordConfirm = usePublishDialogSelector(
        (s) => s.formState[constants.PublishFormFields.ContainerAdminPasswordConfirm],
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

        const { formState, formComponents } = context.state;

        // Default container port if not already set (requested behavior: default to 1433)
        if (!formState.containerPort) {
            context.formAction({
                propertyName: constants.PublishFormFields.ContainerPort,
                isAction: false,
                value: constants.DefaultSqlPortNumber,
                updateValidation: true,
            });
        }

        // If image tag options were populated and user hasn't chosen yet, pick the first option.
        if (!formState.containerImageTag) {
            const tagComp = formComponents[constants.PublishFormFields.ContainerImageTag] as
                | PublishDialogFormItemSpec
                | undefined;
            const firstOption = tagComp?.options?.[0];
            if (firstOption) {
                context.formAction({
                    propertyName: tagComp.propertyName,
                    isAction: false,
                    value: firstOption.value,
                    updateValidation: true,
                });
            }
        }
    }, [isContainer, context]);

    // Revalidate confirm password whenever the primary password changes so stale
    // (previously matching) confirm value doesn't remain marked valid.
    useEffect(() => {
        if (!isContainer) {
            return;
        }
        // Only attempt revalidation if the user has entered something in confirm field.
        // We still want the presence logic to handle the empty confirm case as "missing".
        if (containerPasswordConfirm !== undefined && containerPasswordConfirm !== "") {
            context.formAction({
                propertyName: constants.PublishFormFields.ContainerAdminPasswordConfirm,
                isAction: false,
                value: containerPasswordConfirm as string,
                updateValidation: true,
            });
        }
    }, [containerPassword, isContainer, containerPasswordConfirm, context]);

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
