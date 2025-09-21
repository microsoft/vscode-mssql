/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect } from "react";
import { makeStyles, Checkbox, tokens } from "@fluentui/react-components";
import { PublishProjectContext } from "../publishProjectStateProvider";
import { usePublishDialogSelector } from "../publishDialogSelector";
import {
    IPublishForm,
    PublishDialogState,
    PublishDialogFormItemSpec,
} from "../../../../sharedInterfaces/publishDialog";
import { FormContextProps } from "../../../../sharedInterfaces/form";
import { FormField } from "../../../common/forms/form.component";
import { getDockerBaseImage } from "../../../../publishProject/dockerUtils";

// Context type used by provider
type PublishFormContext = FormContextProps<
    IPublishForm,
    PublishDialogState,
    PublishDialogFormItemSpec
> & {
    publishNow: () => void;
    generatePublishScript: () => void;
    selectPublishProfile: () => void;
    savePublishProfile: (profileName: string) => void;
};

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
    "containerPort",
    "containerAdminPassword",
    "containerAdminPasswordConfirm",
    "containerImageTag",
    "acceptContainerLicense",
];

export const PublishTargetSection: React.FC<{ idx: number }> = ({ idx }) => {
    const classes = useStyles();
    const context = useContext(PublishProjectContext) as PublishFormContext | undefined;

    // Select just the publishTarget FormItemSpec
    const targetSpec = usePublishDialogSelector(
        (s) => s.formComponents.publishTarget as PublishDialogFormItemSpec | undefined,
        Object.is,
    );

    // Select the current target value
    const publishTargetValue = usePublishDialogSelector(
        (s) => s.formState.publishTarget,
        (a, b) => a === b,
    );

    if (!context || !targetSpec || targetSpec.hidden) {
        return undefined;
    }

    const isContainer = publishTargetValue === "localContainer";

    // Side-effects: default port + fetch docker tags when entering container mode
    useEffect(() => {
        if (!isContainer) {
            return;
        }

        // Example: set default port once
        if (!context.state.formState.containerPort) {
            context.formAction({
                propertyName: "containerPort",
                isAction: false,
                value: "1433",
            });
        }

        const tagSpec = context.state.formComponents.containerImageTag as
            | PublishDialogFormItemSpec
            | undefined;
        if (tagSpec && (!tagSpec.options || tagSpec.options.length === 0)) {
            const targetVersion = context.state.projectProperties?.targetVersion || "";
            const base = getDockerBaseImage(targetVersion, undefined);
            const rpc: { action?: (type: string, payload: unknown) => void } | undefined = (
                context as unknown as {
                    extensionRpc?: { action?: (type: string, payload: unknown) => void };
                }
            ).extensionRpc;
            rpc?.action?.("fetchDockerTags", { tagsUrl: base.tagsUrl });
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
                        if (name === "acceptContainerLicense") {
                            const validation = comp.validation;
                            const isError = validation ? !validation.isValid : false;
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
                                        checked={
                                            (context.state.formState[
                                                comp.propertyName as keyof IPublishForm
                                            ] as boolean) ?? false
                                        }
                                        onChange={(_e, data) =>
                                            context.formAction({
                                                propertyName: comp.propertyName,
                                                isAction: false,
                                                value: data.checked,
                                            })
                                        }
                                        style={{ alignItems: "flex-start" }}
                                    />
                                    {isError && validation?.validationMessage && (
                                        <span
                                            style={{
                                                color: tokens.colorStatusDangerForeground1,
                                                fontSize: 12,
                                            }}>
                                            {validation.validationMessage}
                                        </span>
                                    )}
                                </div>
                            );
                        }

                        // Ensure dropdown has options array
                        if (name === "containerImageTag" && !comp.options) {
                            comp.options = [];
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
