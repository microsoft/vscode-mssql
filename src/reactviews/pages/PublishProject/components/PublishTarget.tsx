/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect } from "react";
import { makeStyles, Checkbox, tokens } from "@fluentui/react-components";
import { getDockerBaseImage } from "../../../../publishProject/dockerUtils"; // only need base image name & URL now
import { FormField } from "../../../common/forms/form.component";
import { PublishProjectContext } from "../publishProjectStateProvider";
import { FormContextProps } from "../../../../sharedInterfaces/form";
import {
    IPublishForm,
    PublishDialogFormItemSpec,
    PublishDialogWebviewState,
} from "../../../../sharedInterfaces/publishDialog";

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
    // Optional: tighten the label line height for multi-line wrapping
    licenseLabel: {
        lineHeight: "1.3",
    },
});

type PublishFormContext = FormContextProps<
    IPublishForm,
    PublishDialogWebviewState,
    PublishDialogFormItemSpec
>;

const containerFieldOrder: (keyof IPublishForm)[] = [
    "containerPort",
    "containerAdminPassword",
    "containerAdminPasswordConfirm",
    "containerImageTag",
    "acceptContainerLicense",
];

export default function PublishTargetField(props: { idx: number }) {
    const { idx } = props;
    const classes = useStyles();
    const contextRaw = useContext(PublishProjectContext) as PublishFormContext | undefined;
    const context = contextRaw as PublishFormContext | undefined;
    if (!context || !context.state) {
        return undefined;
    }
    const state = context.state;
    const targetComponent = state.formComponents.publishTarget as
        | PublishDialogFormItemSpec
        | undefined;
    if (!targetComponent) {
        return undefined;
    }
    const isContainer = state.formState.publishTarget === "localContainer";

    useEffect(() => {
        if (!isContainer) {
            return;
        }
        // Default port once
        if (!state.formState.containerPort) {
            context.formAction({ propertyName: "containerPort", isAction: false, value: "1433" });
        }
        const imgSpec = state.formComponents.containerImageTag as
            | PublishDialogFormItemSpec
            | undefined;
        if (!imgSpec) {
            return;
        }
        // If options already populated, do nothing
        if (imgSpec.options && imgSpec.options.length > 0) {
            return;
        }
        const targetVersion =
            (state as PublishDialogWebviewState).projectProperties?.targetVersion || "";
        const base = getDockerBaseImage(targetVersion, undefined);
        const rpc = (context as unknown as { extensionRpc?: { action?: Function } }).extensionRpc;
        if (rpc?.action) {
            console.log("[PublishDialog][Container] Fetching docker tags (minimal)", {
                baseImage: base.name,
                url: base.tagsUrl,
            });
            void rpc.action("fetchDockerTags", { tagsUrl: base.tagsUrl });
        }
    }, [isContainer]);

    return (
        <div className={classes.root}>
            <FormField<
                IPublishForm,
                PublishDialogWebviewState,
                PublishDialogFormItemSpec,
                PublishFormContext
            >
                context={context}
                component={targetComponent}
                idx={idx}
                props={{ orientation: "horizontal" }}
            />
            {isContainer && (
                <div className={classes.containerGroup}>
                    {containerFieldOrder.map((name, cIdx) => {
                        const comp = state.formComponents[name] as
                            | PublishDialogFormItemSpec
                            | undefined;
                        if (!comp || comp.hidden) {
                            return undefined;
                        }
                        // Having the label front and follwed by checkbox has a layout issue for the label gets wrapped in next line
                        // So we are moving the checkbox to front
                        if (name === "acceptContainerLicense") {
                            const validation = comp.validation;
                            const isError = validation ? !validation.isValid : false;

                            const licenseLabel = (
                                <span
                                    className={classes.licenseLabel}
                                    // label text may contain an anchor – keep existing HTML
                                    dangerouslySetInnerHTML={{ __html: comp.label ?? "" }}
                                />
                            );

                            return (
                                <div key={String(name)} className={classes.licenseBlock}>
                                    <Checkbox
                                        size="medium"
                                        label={licenseLabel}
                                        checked={
                                            (state.formState[
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
                                        // Align label start with top of the checkbox for multi-line wrapping
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
                        if (name === "containerImageTag") {
                            // Ensure options array exists to satisfy dropdown component requirement
                            if (!comp.options) {
                                comp.options = [];
                            }
                            return (
                                <FormField<
                                    IPublishForm,
                                    PublishDialogWebviewState,
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
                        }
                        return (
                            <FormField<
                                IPublishForm,
                                PublishDialogWebviewState,
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
}
