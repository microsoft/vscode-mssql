/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Accordion,
    AccordionHeader,
    AccordionItem,
    AccordionPanel,
    Button,
    DrawerBody,
    DrawerHeader,
    DrawerHeaderTitle,
    OverlayDrawer,
    SearchBox,
    Checkbox,
    InfoLabel,
    makeStyles,
} from "@fluentui/react-components";
import { Dismiss24Regular } from "@fluentui/react-icons";
import React, { useState, useContext } from "react";
import { LocConstants } from "../../../common/locConstants";
import { PublishProjectContext } from "../publishProjectStateProvider";
import { usePublishDialogSelector } from "../publishDialogSelector";
import { useAccordionStyles } from "../../../common/styles";

const useStyles = makeStyles({
    optionsList: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
    },
    drawerContent: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
    },
    scrollableContent: {
        flex: 1,
        overflow: "auto",
        paddingBottom: "16px",
    },
    stickyFooter: {
        position: "sticky",
        bottom: "0",
        backgroundColor: "var(--colorNeutralBackground1)",
        borderTop: "1px solid var(--colorNeutralStroke2)",
        padding: "16px 0",
        display: "flex",
        justifyContent: "flex-end",
        gap: "8px",
        marginTop: "auto",
    },
});

export const AdvancedDeploymentOptionsDrawer = ({
    isAdvancedDrawerOpen,
    setIsAdvancedDrawerOpen,
}: {
    isAdvancedDrawerOpen: boolean;
    setIsAdvancedDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
    const classes = useStyles();
    const accordionStyles = useAccordionStyles();
    const context = useContext(PublishProjectContext);
    const [searchText, setSearchText] = useState<string>("");
    const [userOpenedSections, setUserOpenedSections] = useState<string[]>(["General"]);
    const loc = LocConstants.getInstance();

    // Local state for temporary changes (only committed on OK), clone the entire deploymentOptions
    const state = usePublishDialogSelector((s) => s);
    const [localChanges, setLocalChanges] = useState(() =>
        state.deploymentOptions ? structuredClone(state.deploymentOptions) : undefined,
    );

    // Update localChanges whenever deploymentOptions change (e.g., from profile loading)
    React.useEffect(() => {
        if (state.deploymentOptions) {
            setLocalChanges(structuredClone(state.deploymentOptions));
        }
    }, [state.deploymentOptions]);

    // Create option groups directly from localChanges (no more groupedAdvancedOptions)
    const optionGroups = React.useMemo(() => {
        if (!localChanges) return [];

        const groups: Array<{
            key: string;
            label: string;
            entries: Array<{
                key: string;
                displayName: string;
                description: string;
                value: boolean;
            }>;
        }> = [];

        // Process boolean options and split into General and Ignore groups
        if (localChanges.booleanOptionsDictionary) {
            const allBooleanEntries = Object.entries(localChanges.booleanOptionsDictionary).map(
                ([key, option]) => ({
                    key,
                    displayName: option.displayName,
                    description: option.description,
                    value: option.value,
                }),
            );

            // Split entries into General and Ignore based on displayName starting with "Ignore"
            const generalEntries = allBooleanEntries
                .filter((entry) => !entry.displayName.startsWith("Ignore"))
                .sort((a, b) => a.displayName.localeCompare(b.displayName));

            const ignoreEntries = allBooleanEntries
                .filter((entry) => entry.displayName.startsWith("Ignore"))
                .sort((a, b) => a.displayName.localeCompare(b.displayName));

            // Add General Options group
            if (generalEntries.length > 0) {
                groups.push({
                    key: "General",
                    label: loc.publishProject.generalOptions,
                    entries: generalEntries,
                });
            }

            // Add Ignore Options group
            if (ignoreEntries.length > 0) {
                groups.push({
                    key: "Ignore",
                    label: "Ignore Options", // Use string directly since ignoreOptions doesn't exist
                    entries: ignoreEntries,
                });
            }
        }

        // Exclude Object Types group
        if (localChanges.objectTypesDictionary) {
            const excludedTypes = localChanges.excludeObjectTypes?.value || [];
            console.log("DEBUG: Creating exclude entries", {
                excludedTypes,
                objectTypesDictionaryKeys: Object.keys(localChanges.objectTypesDictionary),
            });

            const excludeEntries = Object.entries(localChanges.objectTypesDictionary)
                .map(([key, displayName]) => {
                    // Case-insensitive comparison: excludedTypes has Pascal case, keys have camel case
                    const isExcluded =
                        Array.isArray(excludedTypes) &&
                        excludedTypes.some(
                            (excludedType) => excludedType.toLowerCase() === key.toLowerCase(),
                        );
                    console.log(`DEBUG: ${key} -> ${displayName} | excluded: ${isExcluded}`);
                    return {
                        key,
                        displayName: displayName || key,
                        description: "",
                        value: isExcluded,
                    };
                })
                .filter((entry) => entry.displayName) // Only include entries with display names
                .sort((a, b) => a.displayName.localeCompare(b.displayName));

            if (excludeEntries.length > 0) {
                groups.push({
                    key: "Exclude",
                    label: loc.publishProject.excludeObjectTypes,
                    entries: excludeEntries,
                });
            }
        }

        return groups;
    }, [localChanges, loc]);

    const handleOptionChange = (optionName: string, checked: boolean) => {
        setLocalChanges((prev) => {
            if (!prev) return prev;
            const updated = structuredClone(prev);

            if (updated.booleanOptionsDictionary?.[optionName]) {
                updated.booleanOptionsDictionary[optionName].value = checked;
            } else if (updated.objectTypesDictionary?.[optionName]) {
                // For exclude object types, checked = excluded
                const excludedTypes = updated.excludeObjectTypes!.value;
                if (checked && !excludedTypes.includes(optionName)) {
                    excludedTypes.push(optionName);
                } else if (!checked && excludedTypes.includes(optionName)) {
                    excludedTypes.splice(excludedTypes.indexOf(optionName), 1);
                }
            }

            return updated;
        });
    };

    const handleReset = () => {
        // Reset to default options but keep dialog open
        if (state.defaultDeploymentOptions) {
            setLocalChanges(structuredClone(state.defaultDeploymentOptions));
        }
    };

    const handleOk = () => {
        // Just pass localChanges directly - it's already the complete deploymentOptions!
        if (localChanges) {
            context?.updateDeploymentOptions(localChanges);
        }
        setIsAdvancedDrawerOpen(false);
    };

    const handleCancel = () => {
        // Reset to original deploymentOptions and close drawer
        setLocalChanges(
            state.deploymentOptions ? structuredClone(state.deploymentOptions) : undefined,
        );
        setIsAdvancedDrawerOpen(false);
    };

    // Helper to check if option matches search
    const isOptionVisible = (option: {
        key: string;
        displayName: string;
        description: string;
        value: boolean;
    }) => {
        if (!searchText) return true;

        const lowerSearch = searchText.toLowerCase();
        return option.displayName.toLowerCase().includes(lowerSearch);
    };

    // Render a single option - much simpler approach
    const renderOption = (option: {
        key: string;
        displayName: string;
        description: string;
        value: boolean;
    }) => {
        return (
            <Checkbox
                key={option.key}
                checked={option.value}
                onChange={(_, data) => handleOptionChange(option.key, data.checked === true)}
                label={
                    option.description ? (
                        <InfoLabel info={option.description}>{option.displayName}</InfoLabel>
                    ) : (
                        option.displayName
                    )
                }
            />
        );
    };

    if (!context) {
        return undefined;
    }

    return (
        <OverlayDrawer
            position="end"
            size="medium"
            open={isAdvancedDrawerOpen}
            onOpenChange={(_, { open }) => !open && handleCancel()}>
            <DrawerHeader>
                <DrawerHeaderTitle
                    action={
                        <Button
                            appearance="subtle"
                            aria-label="Close"
                            icon={<Dismiss24Regular />}
                            onClick={handleCancel}
                        />
                    }>
                    {loc.publishProject.advancedPublishSettings}
                </DrawerHeaderTitle>
            </DrawerHeader>

            <DrawerBody>
                <div className={classes.drawerContent}>
                    <div className={classes.scrollableContent}>
                        <SearchBox
                            size="medium"
                            style={{ width: "100%", maxWidth: "100%", marginBottom: "16px" }}
                            placeholder={loc.connectionDialog.searchSettings}
                            onChange={(_e, data) => setSearchText(data.value ?? "")}
                            value={searchText}
                        />

                        <Accordion
                            multiple
                            collapsible
                            onToggle={(_e, data) => {
                                if (!searchText) {
                                    setUserOpenedSections(data.openItems as string[]);
                                }
                            }}
                            openItems={
                                searchText ? optionGroups.map((g) => g.key) : userOpenedSections
                            }>
                            {optionGroups
                                .filter((group) =>
                                    group.entries.some((option) => isOptionVisible(option)),
                                )
                                .map((group) => (
                                    <AccordionItem
                                        key={group.key}
                                        value={group.key}
                                        className={accordionStyles.accordionItem}>
                                        <AccordionHeader>{group.label}</AccordionHeader>
                                        <AccordionPanel>
                                            <div className={classes.optionsList}>
                                                {group.entries
                                                    .filter((option) => isOptionVisible(option))
                                                    .map((option) => renderOption(option))}
                                            </div>
                                        </AccordionPanel>
                                    </AccordionItem>
                                ))}
                        </Accordion>
                    </div>

                    <div className={classes.stickyFooter}>
                        <Button
                            appearance="secondary"
                            onClick={handleReset}
                            disabled={isResetDisabled}>
                            {loc.schemaCompare.reset}
                        </Button>
                        <Button appearance="primary" onClick={handleOk}>
                            {loc.objectExplorerFiltering.ok}
                        </Button>
                    </div>
                </div>
            </DrawerBody>
        </OverlayDrawer>
    );
};
