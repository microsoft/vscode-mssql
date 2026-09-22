/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Checkbox,
    Dropdown,
    Field,
    InfoLabel,
    Input,
    Link,
    makeStyles,
    Option,
    tokens,
} from "@fluentui/react-components";
import { useContext } from "react";
import {
    AzureSqlContainerForm,
    AzureSqlContainerFormErrors,
} from "../../../../sharedInterfaces/azureSqlDatabase";
import { FormContextProps } from "../../../../sharedInterfaces/form";
import { FormInput } from "../../../common/forms/form.component";
import { CollapsibleSection } from "../../../common/collapsibleSection";
import { locConstants } from "../../../common/locConstants";
import { DeploymentContext } from "../deploymentStateProvider";
import { useDeploymentSelector } from "../deploymentSelector";
import { SearchableDropdown } from "../../../common/searchableDropdown.component";
import {
    getSqlPasswordValidationError,
    SqlPasswordValidationError,
} from "../../../../utils/sqlStringUtils";

const useStyles = makeStyles({
    form: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        minHeight: "fit-content",
        padding: "4px 1px 8px",
        boxSizing: "border-box",
        whiteSpace: "normal",
    },
    advanced: {
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        width: "100%",
        minWidth: 0,
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
    termsCard: {
        marginTop: "4px",
        width: "100%",
        borderRadius: "8px",
        border: "1px solid var(--vscode-editorWidget-border)",
        backgroundColor: "var(--vscode-editorWidget-background, var(--vscode-editor-background))",
        padding: "10px 14px",
        boxSizing: "border-box",
    },
    terms: {
        display: "inline-flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "4px",
        minWidth: 0,
        color: tokens.colorNeutralForeground1,
    },
    required: {
        color: tokens.colorPaletteRedForeground1,
    },
});

interface AzureSqlDatabaseContainerFormPageProps {
    form: AzureSqlContainerForm;
    errors: AzureSqlContainerFormErrors;
    disabled: boolean;
    onChange: (form: AzureSqlContainerForm) => void;
}

export const AzureSqlDatabaseContainerFormPage: React.FC<
    AzureSqlDatabaseContainerFormPageProps
> = ({ form, errors, disabled, onChange }) => {
    const classes = useStyles();
    const context = useContext(DeploymentContext);
    const groups = useDeploymentSelector((s) => s.connectionGroupOptions);
    const groupOptions = groups.map((group) => ({
        value: group.value,
        text: group.displayName,
    }));
    const loc = locConstants.azureSqlContainer;

    if (!context) {
        return undefined;
    }

    const passwordContext: FormContextProps<AzureSqlContainerForm> = {
        ...context,
        formAction: (event) => {
            if (event.propertyName === "password" && typeof event.value === "string") {
                onChange({ ...form, password: event.value });
            }
        },
    };
    const label = (text: string, tooltip?: string) =>
        tooltip ? <InfoLabel info={tooltip}>{text}</InfoLabel> : <span>{text}</span>;
    const passwordValidationError = form.password
        ? getSqlPasswordValidationError(form.password)
        : undefined;
    const passwordValidationMessage =
        errors.password ??
        (passwordValidationError === SqlPasswordValidationError.Length
            ? loc.passwordLengthError
            : passwordValidationError === SqlPasswordValidationError.Complexity
              ? loc.passwordComplexityError
              : undefined);

    return (
        <div className={classes.form}>
            <Field
                label={label(
                    locConstants.azureSqlDatabase.authenticationType,
                    loc.authenticationTooltip,
                )}
                required>
                <Dropdown size="small" value={loc.sqlLogin} selectedOptions={["SqlLogin"]} disabled>
                    <Option value="SqlLogin">{loc.sqlLogin}</Option>
                </Dropdown>
            </Field>
            <Field label={label(locConstants.azureSqlDatabase.userName, loc.userNameTooltip)}>
                <Input size="small" value="sa" readOnly />
            </Field>
            <Field
                label={label(locConstants.azureSqlDatabase.password, loc.passwordTooltip)}
                required
                validationState={passwordValidationMessage ? "error" : "none"}
                validationMessage={passwordValidationMessage}>
                <FormInput
                    context={passwordContext}
                    formState={form}
                    target="password"
                    value={form.password}
                    type="password"
                    placeholder={locConstants.azureSqlDatabase.enterPassword}
                    props={{ disabled, autoComplete: "new-password" }}
                />
            </Field>
            <div className={classes.savePasswordRow}>
                <span className={classes.savePasswordLabel}>
                    <InfoLabel info={loc.savePasswordTooltip}>
                        {locConstants.azureSqlDatabase.savePassword}
                    </InfoLabel>
                </span>
                <Checkbox
                    size="medium"
                    aria-label={locConstants.azureSqlDatabase.savePassword}
                    checked={form.savePassword}
                    disabled={disabled}
                    onChange={(_, data) =>
                        onChange({ ...form, savePassword: data.checked === true })
                    }
                />
            </div>
            <Field label={label(loc.profileName, loc.profileNameTooltip)}>
                <Input
                    size="small"
                    value={form.profileName}
                    placeholder={loc.profileNamePlaceholder}
                    disabled={disabled}
                    onChange={(_, data) => onChange({ ...form, profileName: data.value })}
                />
            </Field>
            <Field
                label={label(loc.connectionGroup)}
                validationState={errors.groupId ? "error" : "none"}
                validationMessage={errors.groupId}>
                <SearchableDropdown
                    size="small"
                    options={groupOptions}
                    selectedOption={groupOptions.find((group) => group.value === form.groupId)}
                    ariaLabel={loc.connectionGroup}
                    showPlaceholder={!form.groupId}
                    placeholder={loc.selectConnectionGroup}
                    disabled={disabled}
                    onSelect={(option) => onChange({ ...form, groupId: option.value })}
                />
            </Field>
            <CollapsibleSection title={locConstants.connectionDialog.advancedOptions} defaultOpen>
                <div className={classes.advanced}>
                    <Field
                        label={label(loc.containerName, loc.containerNameTooltip)}
                        validationState={errors.containerName ? "error" : "none"}
                        validationMessage={errors.containerName}>
                        <Input
                            size="small"
                            value={form.containerName}
                            placeholder="azure_sql_db_container"
                            disabled={disabled}
                            onChange={(_, data) => onChange({ ...form, containerName: data.value })}
                        />
                    </Field>
                    <Field
                        label={label(loc.port, loc.portTooltip)}
                        validationState={errors.port ? "error" : "none"}
                        validationMessage={errors.port}>
                        <Input
                            size="small"
                            value={form.port}
                            inputMode="numeric"
                            disabled={disabled}
                            onChange={(_, data) => onChange({ ...form, port: data.value })}
                        />
                    </Field>
                    <Field
                        label={label(loc.hostname, loc.hostnameTooltip)}
                        validationState={errors.hostname ? "error" : "none"}
                        validationMessage={errors.hostname}>
                        <Input
                            size="small"
                            value={form.hostname}
                            placeholder={loc.optional}
                            disabled={disabled}
                            onChange={(_, data) => onChange({ ...form, hostname: data.value })}
                        />
                    </Field>
                </div>
            </CollapsibleSection>
            <Field
                className={classes.termsCard}
                validationState={errors.acceptEula ? "error" : "none"}
                validationMessage={errors.acceptEula}>
                <Checkbox
                    checked={form.acceptEula}
                    disabled={disabled}
                    onChange={(_, data) => onChange({ ...form, acceptEula: data.checked === true })}
                    label={
                        <span className={classes.terms}>
                            {loc.acceptTerms}
                            <Link
                                href="https://go.microsoft.com/fwlink/?LinkId=746388"
                                target="_blank"
                                rel="noopener noreferrer">
                                {loc.termsAndConditions}
                            </Link>
                            <span className={classes.required}>*</span>
                            <InfoLabel info={loc.termsTooltip} />
                        </span>
                    }
                />
            </Field>
        </div>
    );
};
