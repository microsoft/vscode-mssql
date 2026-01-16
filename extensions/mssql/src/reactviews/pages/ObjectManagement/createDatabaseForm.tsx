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
} from "@fluentui/react-components";
import {
    CreateDatabaseParams,
    CreateDatabaseViewModel,
} from "../../../sharedInterfaces/objectManagement";
import { locConstants } from "../../common/locConstants";
import { SearchableDropdown } from "../../common/searchableDropdown.component";

const useStyles = makeStyles({
    section: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
    },
    sectionTitle: {
        fontSize: "14px",
        fontWeight: "600",
        color: "var(--vscode-foreground)",
    },
    fieldGroup: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        marginTop: "4px",
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
                    size="medium"
                />
            </Field>
        );
    };

    return (
        <>
            <div className={styles.section}>
                <div className={styles.sectionTitle}>
                    {locConstants.createDatabase.generalSection}
                </div>
                <div className={styles.fieldGroup}>
                    <Field
                        size="medium"
                        label={locConstants.createDatabase.nameLabel}
                        required
                        validationMessage={nameValidationMessage}
                        validationState={nameValidationState ?? "none"}>
                        <Input
                            size="medium"
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
                <Accordion collapsible>
                    <AccordionItem value="options">
                        <AccordionHeader className={styles.sectionTitle}>
                            {locConstants.createDatabase.optionsSection}
                        </AccordionHeader>
                        <AccordionPanel>
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
        </>
    );
};
