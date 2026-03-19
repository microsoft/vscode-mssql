/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import { Checkbox, Link, makeStyles } from "@fluentui/react-components";
import { FormField } from "../../../common/forms/form.component";
import {
    LocalContainersContextProps,
    LocalContainersFormItemSpec,
    LocalContainersState,
    DockerConnectionProfile,
} from "../../../../sharedInterfaces/localContainers";
import { ChevronDown20Regular, ChevronRight20Regular } from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";
import { ConnectionGroupDialog } from "../../ConnectionGroup/connectionGroup.component";
import {
    CREATE_NEW_GROUP_ID,
    CreateConnectionGroupDialogProps,
} from "../../../../sharedInterfaces/connectionGroup";
import {
    renderColorSwatch,
    SearchableDropdownOptions,
} from "../../../common/searchableDropdown.component";
import { DeploymentContext } from "../deploymentStateProvider";
import { useDeploymentSelector } from "../deploymentSelector";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        minWidth: 0,
    },
    formDiv: {
        display: "flex",
        flexDirection: "column",
        width: "100%",
    },
    advancedCard: {
        border: `1px solid var(--vscode-editorGroup-border)`,
        borderRadius: "7px",
        overflow: "hidden",
        marginBottom: "16px",
    },
    advancedToggle: {
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: "10px 14px",
        color: "var(--vscode-foreground)",
    },
    advancedContent: {
        padding: "4px 14px 14px",
        borderTop: `1px solid var(--vscode-editorGroup-border)`,
    },
    eulaCard: {
        background: "var(--vscode-editorWidget-background, var(--vscode-editor-background))",
        border: `1px solid var(--vscode-editorGroup-border)`,
        borderRadius: "7px",
        padding: "6px 8px",
        marginTop: "8px",
    },
});

export const LocalContainersInputForm: React.FC = () => {
    const classes = useStyles();
    const context = useContext(DeploymentContext);
    const dialog = useDeploymentSelector((s) => s.dialog);
    const localContainersState = useDeploymentSelector(
        (s) => s.deploymentTypeState,
    ) as LocalContainersState;
    const [showAdvancedOptions, setShowAdvanced] = useState(false);

    if (!context || !localContainersState) return undefined;

    const { formComponents } = localContainersState;

    const renderFormField = (propertyName: string) => {
        const component = formComponents[
            propertyName as keyof typeof formComponents
        ] as LocalContainersFormItemSpec;
        if (!component) return undefined;
        return (
            <FormField<
                DockerConnectionProfile,
                LocalContainersState,
                LocalContainersFormItemSpec,
                LocalContainersContextProps
            >
                context={context}
                formState={localContainersState.formState}
                component={component}
                idx={0}
            />
        );
    };

    const renderAdvancedFields = () =>
        Object.values(formComponents)
            .filter((component) => component.isAdvancedOption)
            .map((component, index) => (
                <FormField<
                    DockerConnectionProfile,
                    LocalContainersState,
                    LocalContainersFormItemSpec,
                    LocalContainersContextProps
                >
                    key={index}
                    context={context}
                    formState={localContainersState.formState}
                    component={component}
                    idx={index}
                />
            ));

    return (
        <div className={classes.outerDiv}>
            <div className={classes.formDiv}>
                {dialog?.type === "createConnectionGroup" && (
                    <ConnectionGroupDialog
                        mode="modal"
                        state={(dialog as CreateConnectionGroupDialogProps).props}
                        saveConnectionGroup={context.createConnectionGroup}
                        closeDialog={() => context.setConnectionGroupDialogState(false)}
                    />
                )}

                {renderFormField("version")}
                {renderFormField("password")}
                {renderFormField("savePassword")}

                {renderFormField("profileName")}
                <FormField<
                    DockerConnectionProfile,
                    LocalContainersState,
                    LocalContainersFormItemSpec,
                    LocalContainersContextProps
                >
                    context={context}
                    formState={localContainersState.formState}
                    component={
                        localContainersState.formComponents[
                            "groupId"
                        ] as LocalContainersFormItemSpec
                    }
                    idx={0}
                    componentProps={{
                        onSelect: (option: SearchableDropdownOptions) => {
                            if (option.value === CREATE_NEW_GROUP_ID) {
                                context.setConnectionGroupDialogState(true);
                            } else {
                                context.formAction({
                                    propertyName: "groupId",
                                    isAction: false,
                                    value: option.value,
                                });
                            }
                        },
                        renderDecoration: (option: SearchableDropdownOptions) => {
                            return renderColorSwatch(option.color);
                        },
                    }}
                />

                <div className={classes.advancedCard}>
                    <button
                        className={classes.advancedToggle}
                        onClick={() => setShowAdvanced(!showAdvancedOptions)}>
                        <span>{locConstants.connectionDialog.advancedOptions}</span>
                        {showAdvancedOptions ? <ChevronDown20Regular /> : <ChevronRight20Regular />}
                    </button>
                    {showAdvancedOptions && (
                        <div className={classes.advancedContent}>{renderAdvancedFields()}</div>
                    )}
                </div>

                <div className={classes.eulaCard}>
                    <Checkbox
                        checked={localContainersState.formState.acceptEula ?? false}
                        onChange={(_ev, data) =>
                            context.formAction({
                                propertyName: "acceptEula",
                                isAction: false,
                                value: data.checked,
                            })
                        }
                        label={
                            <span>
                                {locConstants.localContainers.iAcceptThe}{" "}
                                <Link
                                    href="https://go.microsoft.com/fwlink/?LinkId=746388"
                                    target="_blank"
                                    rel="noopener noreferrer">
                                    {locConstants.localContainers.termsAndConditions}
                                </Link>
                                <span style={{ color: "#e05252", marginLeft: 3 }}>*</span>
                            </span>
                        }
                    />
                </div>
            </div>
        </div>
    );
};
