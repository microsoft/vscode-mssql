/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import {
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
    Settings20Regular,
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
import { useDeploymentSelector, useLocalContainersDeploymentSelector } from "../deploymentSelector";

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
        width: "100%",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: "8px",
    },
    bottomDiv: {
        paddingBottom: "8px",
    },
    formDiv: {
        flexGrow: 1,
        width: "100%",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: "8px",
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
        minWidth: 0,
        whiteSpace: "normal",
        overflowWrap: "break-word",
        wordBreak: "break-word",
    },
    savePasswordRow: {
        display: "flex",
        alignItems: "center",
        gap: "4px",
        width: "100%",
    },
    savePasswordLabel: {
        display: "inline-flex",
        alignItems: "center",
        color: tokens.colorNeutralForeground1,
    },
    savePasswordCheckbox: {
        flexShrink: 0,
    },
    advancedToggle: {
        width: "100%",
    },
    advancedSection: {
        width: "100%",
        borderRadius: "6px",
        border: "1px solid var(--vscode-editorWidget-border, var(--vscode-input-border))",
        overflow: "hidden",
        backgroundColor: "var(--vscode-editorWidget-background, var(--vscode-editor-background))",
    },
    advancedToggleButton: {
        width: "100%",
        border: "none",
        backgroundColor:
            "var(--vscode-sideBar-background, var(--vscode-editorWidget-background, var(--vscode-editor-background)))",
        color: tokens.colorNeutralForeground2,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "9px 12px",
        cursor: "pointer",
        fontFamily: "inherit",
        textAlign: "left",
    },
    advancedToggleContent: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        fontSize: "13px",
        fontWeight: 500,
    },
    advancedIcon: {
        color: tokens.colorNeutralForeground3,
    },
    advancedChevron: {
        color: tokens.colorNeutralForeground3,
        display: "flex",
        alignItems: "center",
    },
    advancedPanelBody: {
        borderTop: "1px solid var(--vscode-editorWidget-border, var(--vscode-input-border))",
        padding: "14px 12px 16px",
    },
    eulaCard: {
        width: "100%",
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
    const loadState = useLocalContainersDeploymentSelector((s) => s.loadState);
    const errorMessage = useLocalContainersDeploymentSelector((s) => s.errorMessage);
    const isDockerProfileValid = useLocalContainersDeploymentSelector(
        (s) => s.isDockerProfileValid,
    );
    const formState = useLocalContainersDeploymentSelector((s) => s.formState);
    const formComponents = useLocalContainersDeploymentSelector((s) => s.formComponents);
    const [showAdvancedOptions, setShowAdvanced] = useState(false);

    if (!context || !formState) return undefined;

    useEffect(() => {
        if (isDockerProfileValid) {
            onValidated?.();
        }
    }, [isDockerProfileValid, onValidated]);

    if (loadState === ApiStatus.Loading) {
        return (
            <div className={classes.spinnerDiv}>
                <Spinner
                    label={locConstants.localContainers.loadingLocalContainers}
                    labelPosition="below"
                />
            </div>
        );
    }

    if (loadState === ApiStatus.Error) {
        return (
            <div className={classes.spinnerDiv}>
                <ErrorCircleRegular className={classes.errorIcon} />
                <Text size={400}>{errorMessage ?? ""}</Text>
            </div>
        );
    }

    const eulaComponent = Object.values(formComponents).find(
        (component) => component.propertyName === "acceptEula",
    )!;
    const eulaValidationState = eulaComponent.validation
        ? eulaComponent.validation.isValid
            ? "none"
            : "error"
        : "none";
    const savePasswordComponent = formComponents["savePassword"] as LocalContainersFormItemSpec;
    const renderField = (
        component: LocalContainersFormItemSpec | undefined,
        idx: number,
        componentProps?: unknown,
        key?: string,
    ) => {
        if (!component) {
            return undefined;
        }

        return (
            <div className={classes.fieldContainer} key={key}>
                <FormField<
                    DockerConnectionProfile,
                    LocalContainersState,
                    LocalContainersFormItemSpec,
                    LocalContainersContextProps
                >
                    context={context}
                    formState={formState}
                    component={component}
                    idx={idx}
                    componentProps={componentProps}
                />
            </div>
        );
    };

    const renderAdvancedFields = () =>
        Object.values(formComponents)
            .filter(
                (component) =>
                    component.isAdvancedOption &&
                    component.propertyName !== "acceptEula" &&
                    component.propertyName !== "groupId" &&
                    component.propertyName !== "savePassword",
            )
            .map((component, index) =>
                renderField(component, index, undefined, component.propertyName),
            );

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
                {renderField(formComponents["version"] as LocalContainersFormItemSpec, 0)}
                {renderField(formComponents["password"] as LocalContainersFormItemSpec, 1)}
                {savePasswordComponent && (
                    <div className={classes.savePasswordRow}>
                        <span className={classes.savePasswordLabel}>
                            {savePasswordComponent.tooltip ? (
                                <InfoLabel info={savePasswordComponent.tooltip}>
                                    <span
                                        dangerouslySetInnerHTML={{
                                            __html: savePasswordComponent.label,
                                        }}
                                    />
                                </InfoLabel>
                            ) : (
                                <span
                                    dangerouslySetInnerHTML={{
                                        __html: savePasswordComponent.label,
                                    }}
                                />
                            )}
                        </span>
                        <Checkbox
                            className={classes.savePasswordCheckbox}
                            size="medium"
                            checked={formState.savePassword ?? false}
                            aria-label={savePasswordComponent.label}
                            onChange={(_value, data) =>
                                context.formAction({
                                    propertyName: "savePassword",
                                    isAction: false,
                                    value: data.checked,
                                })
                            }
                        />
                    </div>
                )}
                {renderField(formComponents["profileName"] as LocalContainersFormItemSpec, 2)}
                {renderField(formComponents["groupId"] as LocalContainersFormItemSpec, 3, {
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
                })}
                <div className={classes.advancedSection}>
                    <button
                        type="button"
                        className={classes.advancedToggleButton}
                        onClick={() => setShowAdvanced(!showAdvancedOptions)}
                        aria-expanded={showAdvancedOptions}>
                        <span className={classes.advancedToggleContent}>
                            <Settings20Regular className={classes.advancedIcon} />
                            {locConstants.connectionDialog.advancedOptions}
                        </span>
                        <span className={classes.advancedChevron}>
                            {showAdvancedOptions ? (
                                <ChevronDown20Regular />
                            ) : (
                                <ChevronRight20Regular />
                            )}
                        </span>
                    </button>
                    {showAdvancedOptions && (
                        <div className={classes.advancedPanelBody}>
                            <div className={classes.advancedOptionsDiv}>
                                {renderAdvancedFields()}
                            </div>
                        </div>
                    )}
                </div>
            </div>
            <div className={classes.bottomDiv}>
                <div className={classes.eulaCard}>
                    <Field
                        validationMessage={eulaComponent.validation?.validationMessage ?? ""}
                        validationState={eulaValidationState}>
                        <Checkbox
                            size="medium"
                            checked={formState.acceptEula ?? false}
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
