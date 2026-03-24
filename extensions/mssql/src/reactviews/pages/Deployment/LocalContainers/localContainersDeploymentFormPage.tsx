/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import {
    Button,
    Checkbox,
    Field,
    InfoLabel,
    makeStyles,
    Spinner,
    Text,
    tokens,
} from "@fluentui/react-components";
import {
    ChevronDown20Regular,
    ChevronRight20Regular,
    ErrorCircleRegular,
} from "@fluentui/react-icons";
import { FormField } from "../../../common/forms/form.component";
import {
    LocalContainersContextProps,
    LocalContainersFormItemSpec,
    LocalContainersState,
    DockerConnectionProfile,
} from "../../../../sharedInterfaces/localContainers";
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
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { DeploymentContext } from "../deploymentStateProvider";
import { useDeploymentSelector } from "../deploymentSelector";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        minHeight: "fit-content",
        padding: "4px 0 8px",
        boxSizing: "border-box",
        whiteSpace: "normal",
    },
    advancedOptionsDiv: {
        marginLeft: "24px",
        width: "100%",
        maxWidth: "600px",
    },
    bottomDiv: {
        paddingBottom: "8px",
    },
    formDiv: {
        flexGrow: 1,
        width: "100%",
        minWidth: 0,
    },
    spinnerDiv: {
        height: "100%",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        padding: "20px",
    },
    errorIcon: {
        fontSize: "100px",
        opacity: 0.5,
    },
    fieldContainer: {
        width: "100%",
        maxWidth: "600px",
        minWidth: 0,
        whiteSpace: "normal",
        overflowWrap: "break-word",
        wordBreak: "break-word",
    },
    advancedToggle: {
        width: "100%",
        maxWidth: "600px",
    },
    eulaCard: {
        width: "100%",
        maxWidth: "600px",
        borderRadius: "8px",
        border: "1px solid var(--vscode-editorWidget-border)",
        backgroundColor: "var(--vscode-editorWidget-background, var(--vscode-editor-background))",
        padding: "10px 14px",
        boxSizing: "border-box",
    },
    eulaLabel: {
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        flexWrap: "wrap",
        minWidth: 0,
        color: tokens.colorNeutralForeground1,
    },
    eulaRequired: {
        color: tokens.colorPaletteRedForeground1,
    },
    eulaInfo: {
        display: "inline-flex",
        alignItems: "center",
    },
});

interface LocalContainersDeploymentFormPageProps {
    onValidated?: () => void;
}

export const LocalContainersDeploymentFormPage: React.FC<
    LocalContainersDeploymentFormPageProps
> = ({ onValidated }) => {
    const classes = useStyles();
    const context = useContext(DeploymentContext);
    const dialog = useDeploymentSelector((s) => s.dialog);
    const localContainersState = useDeploymentSelector(
        (s) => s.deploymentTypeState,
    ) as LocalContainersState;
    const [showAdvancedOptions, setShowAdvanced] = useState(false);

    if (!context || !localContainersState) return undefined;

    useEffect(() => {
        if (localContainersState.isDockerProfileValid) {
            onValidated?.();
        }
    }, [localContainersState.isDockerProfileValid, onValidated]);

    if (localContainersState.loadState === ApiStatus.Loading) {
        return (
            <div className={classes.spinnerDiv}>
                <Spinner
                    label={locConstants.localContainers.loadingLocalContainers}
                    labelPosition="below"
                />
            </div>
        );
    }

    if (localContainersState.loadState === ApiStatus.Error) {
        return (
            <div className={classes.spinnerDiv}>
                <ErrorCircleRegular className={classes.errorIcon} />
                <Text size={400}>{localContainersState.errorMessage ?? ""}</Text>
            </div>
        );
    }

    const { formComponents } = localContainersState;
    const eulaComponent = Object.values(formComponents).find(
        (component) => component.propertyName === "acceptEula",
    )!;
    const eulaValidationState = eulaComponent.validation
        ? eulaComponent.validation.isValid
            ? "none"
            : "error"
        : "none";

    const renderFormFields = (isAdvanced: boolean) =>
        Object.values(formComponents)
            .filter(
                (component) =>
                    component.isAdvancedOption === isAdvanced &&
                    component.propertyName !== "acceptEula" &&
                    component.propertyName !== "groupId",
            )
            .map((component, index) => (
                <div key={index} className={classes.fieldContainer}>
                    <FormField<
                        DockerConnectionProfile,
                        LocalContainersState,
                        LocalContainersFormItemSpec,
                        LocalContainersContextProps
                    >
                        context={context}
                        formState={localContainersState.formState}
                        component={component}
                        idx={index}
                    />
                </div>
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
                {renderFormFields(false)}
                <div className={classes.fieldContainer}>
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
                </div>
                <div className={classes.advancedToggle}>
                    <Button
                        icon={
                            showAdvancedOptions ? (
                                <ChevronDown20Regular />
                            ) : (
                                <ChevronRight20Regular />
                            )
                        }
                        appearance="subtle"
                        onClick={() => setShowAdvanced(!showAdvancedOptions)}
                    />
                    {locConstants.connectionDialog.advancedOptions}
                </div>

                {showAdvancedOptions && (
                    <div className={classes.advancedOptionsDiv}>{renderFormFields(true)}</div>
                )}
            </div>
            <div className={classes.bottomDiv}>
                <div className={classes.eulaCard}>
                    <Field
                        validationMessage={eulaComponent.validation?.validationMessage ?? ""}
                        validationState={eulaValidationState}>
                        <Checkbox
                            size="medium"
                            checked={localContainersState.formState.acceptEula ?? false}
                            onChange={(_value, data) =>
                                context.formAction({
                                    propertyName: "acceptEula",
                                    isAction: false,
                                    value: data.checked,
                                })
                            }
                            label={
                                <span className={classes.eulaLabel}>
                                    <span
                                        dangerouslySetInnerHTML={{
                                            __html: eulaComponent.label,
                                        }}
                                    />
                                    {eulaComponent.required && (
                                        <span className={classes.eulaRequired}>*</span>
                                    )}
                                    {eulaComponent.tooltip && (
                                        <InfoLabel
                                            info={eulaComponent.tooltip}
                                            className={classes.eulaInfo}
                                            size="small">
                                            <span aria-hidden="true" />
                                        </InfoLabel>
                                    )}
                                </span>
                            }
                        />
                    </Field>
                </div>
            </div>
        </div>
    );
};
