/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Accordion,
    AccordionHeader,
    AccordionItem,
    AccordionPanel,
    Checkbox,
    Field,
    Input,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import {
    CreateDatabaseParams,
    CreateDatabaseViewModel,
} from "../../../sharedInterfaces/objectManagement";
import { locConstants } from "../../common/locConstants";
import { SearchableDropdown } from "../../common/searchableDropdown.component";

const useStyles = makeStyles({
    root: {
        width: "100%",
        maxWidth: "560px",
        display: "flex",
        flexDirection: "column",
        gap: "22px",
    },
    section: {
        display: "flex",
        flexDirection: "column",
        gap: "14px",
    },
    sectionHeader: {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        paddingBottom: "10px",
        borderBottom: "1px solid var(--vscode-editorGroup-border)",
    },
    sectionTitle: {
        fontSize: tokens.fontSizeBase300,
        lineHeight: tokens.lineHeightBase300,
        fontWeight: tokens.fontWeightSemibold,
        color: "var(--vscode-foreground)",
    },
    fieldGroup: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        marginTop: "4px",
    },
    advancedHeader: {
        padding: 0,
        minHeight: "28px",
        color: "var(--vscode-foreground)",
        fontSize: tokens.fontSizeBase300,
        fontWeight: tokens.fontWeightSemibold,
        "> .fui-AccordionHeader__button": {
            paddingLeft: 0,
            paddingRight: 0,
        },
        "> .fui-AccordionHeader__button > .fui-AccordionHeader__expandIcon": {
            paddingLeft: 0,
            paddingRight: tokens.spacingHorizontalXS,
        },
    },
    advancedPanel: {
        padding: "12px 0 0 14px",
        marginLeft: "6px",
        borderLeft: "2px solid var(--vscode-editorGroup-border)",
    },
});

export interface CreateDatabaseFormState extends CreateDatabaseParams {}

export interface CreateDatabaseFormProps {
    value: CreateDatabaseFormState;
    viewModel: CreateDatabaseViewModel;
    nameValidationMessage?: string;
    nameValidationState?: "none" | "error";
    onChange: (next: CreateDatabaseFormState) => void;
}

export const CreateDatabaseForm = ({
    value,
    viewModel,
    nameValidationMessage,
    nameValidationState,
    onChange,
}: CreateDatabaseFormProps) => {
    const styles = useStyles();

    const renderDropdown = (
        label: string,
        options: string[] | undefined,
        selected: string | undefined,
        onSelect: (newValue: string) => void,
    ) => {
        if (!options || options.length === 0) {
            return undefined;
        }
        const dropdownOptions = options.map((option) => ({
            value: option,
            text: option,
        }));
        return (
            <Field label={label}>
                <SearchableDropdown
                    options={dropdownOptions}
                    selectedOption={selected ? { value: selected, text: selected } : undefined}
                    onSelect={(option) => onSelect(option.value)}
                    ariaLabel={label}
                    size="small"
                />
            </Field>
        );
    };

    return (
        <div className={styles.root}>
            <div className={styles.section}>
                <div className={styles.sectionHeader}>
                    <div className={styles.sectionTitle}>
                        {locConstants.createDatabase.generalSection}
                    </div>
                </div>
                <div className={styles.fieldGroup}>
                    <Field
                        size="small"
                        label={locConstants.createDatabase.nameLabel}
                        required
                        validationMessage={nameValidationMessage}
                        validationState={nameValidationState ?? "none"}>
                        <Input
                            size="small"
                            placeholder={locConstants.createDatabase.namePlaceholder}
                            value={value.name}
                            onChange={(_, data) =>
                                onChange({
                                    ...value,
                                    name: data.value,
                                })
                            }
                            maxLength={128}
                        />
                    </Field>
                    {renderDropdown(
                        locConstants.createDatabase.ownerLabel,
                        viewModel.ownerOptions,
                        value.owner,
                        (nextOwner) => onChange({ ...value, owner: nextOwner }),
                    )}
                </div>
            </div>
            <div className={styles.section}>
                <Accordion collapsible defaultOpenItems={["advanced"]}>
                    <AccordionItem value="advanced">
                        <AccordionHeader className={styles.advancedHeader}>
                            {locConstants.createDatabase.optionsSection}
                        </AccordionHeader>
                        <AccordionPanel className={styles.advancedPanel}>
                            <div className={styles.fieldGroup}>
                                {renderDropdown(
                                    locConstants.createDatabase.collationLabel,
                                    viewModel.collationOptions,
                                    value.collationName,
                                    (nextValue) => onChange({ ...value, collationName: nextValue }),
                                )}
                                {renderDropdown(
                                    locConstants.createDatabase.recoveryModelLabel,
                                    viewModel.recoveryModelOptions,
                                    value.recoveryModel,
                                    (nextValue) => onChange({ ...value, recoveryModel: nextValue }),
                                )}
                                {renderDropdown(
                                    locConstants.createDatabase.compatibilityLevelLabel,
                                    viewModel.compatibilityLevelOptions,
                                    value.compatibilityLevel,
                                    (nextValue) =>
                                        onChange({ ...value, compatibilityLevel: nextValue }),
                                )}
                                {renderDropdown(
                                    locConstants.createDatabase.containmentTypeLabel,
                                    viewModel.containmentTypeOptions,
                                    value.containmentType,
                                    (nextValue) =>
                                        onChange({ ...value, containmentType: nextValue }),
                                )}
                                {viewModel.isLedgerDatabase !== undefined && (
                                    <Checkbox
                                        label={locConstants.createDatabase.isLedgerDatabaseLabel}
                                        checked={value.isLedgerDatabase ?? false}
                                        onChange={(_event, data) =>
                                            onChange({
                                                ...value,
                                                isLedgerDatabase: !!data.checked,
                                            })
                                        }
                                    />
                                )}
                            </div>
                        </AccordionPanel>
                    </AccordionItem>
                </Accordion>
            </div>
        </div>
    );
};
