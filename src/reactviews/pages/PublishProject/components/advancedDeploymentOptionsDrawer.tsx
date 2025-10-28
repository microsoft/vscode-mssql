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

    // Update localChanges when drawer opens with fresh data
    React.useEffect(() => {
        if (isAdvancedDrawerOpen && state.deploymentOptions) {
            setLocalChanges(structuredClone(state.deploymentOptions));
        }
    }, [isAdvancedDrawerOpen, state.deploymentOptions]);

    // Get grouped options and update values from localChanges
    const optionGroups = usePublishDialogSelector((s) => {
        if (!s.groupedAdvancedOptions || !localChanges) return [];

        return s.groupedAdvancedOptions.map((group) => ({
            ...group,
            entries: group.entries.map((option) => ({
                ...option,
                value:
                    localChanges.booleanOptionsDictionary?.[option.key]?.value ??
                    (group.key === "Exclude"
                        ? (localChanges.excludeObjectTypes?.value?.includes(option.key) ?? false)
                        : option.value),
            })),
        }));
    });

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
                        <Button appearance="secondary" onClick={handleReset}>
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
