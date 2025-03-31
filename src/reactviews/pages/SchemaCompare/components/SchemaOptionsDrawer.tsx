/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import {
    Accordion,
    AccordionHeader,
    AccordionItem,
    AccordionPanel,
    Button,
    Checkbox,
    Drawer,
    DrawerBody,
    DrawerFooter,
    DrawerHeader,
    DrawerHeaderTitle,
    Label,
    makeStyles,
    SelectTabData,
    SelectTabEvent,
    Tab,
    TabList,
    TabValue,
} from "@fluentui/react-components";
import { Dismiss24Regular } from "@fluentui/react-icons";
import { locConstants as loc } from "../../../common/locConstants";
import { List, ListItem } from "@fluentui/react-list-preview";
import { schemaCompareContext } from "../SchemaCompareStateProvider";
import { DacDeployOptionPropertyBoolean } from "vscode-mssql";

const useStyles = makeStyles({
    generalOptionsContainer: {
        height: "55vh",
        overflowY: "auto",
    },

    objectTypesContainer: {
        height: "80vh",
        overflowY: "auto",
    },
});

interface Props {
    show: boolean;
    showDrawer: (show: boolean) => void;
}

const SchemaOptionsDrawer = (props: Props) => {
    const classes = useStyles();

    const context = useContext(schemaCompareContext);

    useEffect(() => {
        context.setIntermediarySchemaOptions();
    }, []);

    const deploymentOptions = context.state.intermediaryOptionsResult?.defaultDeploymentOptions;

    const optionsToValueNameLookup = deploymentOptions?.booleanOptionsDictionary;
    let generalOptionEntries: Array<[string, DacDeployOptionPropertyBoolean]> = [];
    if (optionsToValueNameLookup) {
        generalOptionEntries = Object.entries(optionsToValueNameLookup);

        generalOptionEntries.sort(([_, value1], [__, value2]) =>
            value1.displayName.toLowerCase().localeCompare(value2.displayName.toLowerCase()),
        );
    }

    const includeObjectTypesLookup = deploymentOptions?.objectTypesDictionary;
    let includeObjectTypesEntries: Array<[string, string]> = [];
    if (includeObjectTypesLookup) {
        includeObjectTypesEntries = Object.entries(includeObjectTypesLookup);

        includeObjectTypesEntries.sort(([key1, _], [key2, __]) =>
            key1.toLowerCase().localeCompare(key2.toLowerCase()),
        );
    }

    const [optionsChanged, setOptionsChanged] = useState(false);
    const [selectedValue, setSelectedValue] = useState<TabValue>("generalOptions");
    const [description, setDescription] = useState<string>("");

    const onTabSelect = (_: SelectTabEvent, data: SelectTabData) => {
        setSelectedValue(data.value);
    };

    const handleSettingChanged = (key: string) => {
        context.intermediaryGeneralOptionsChanged(key);

        setOptionsChanged(true);
    };

    const handleObjectTypesOptionChanged = (key: string) => {
        context.intermediaryIncludeObjectTypesOptionsChanged(key);

        setOptionsChanged(true);
    };

    const handleSetObjectTypesCheckedState = (optionName: string): boolean => {
        const isFound = deploymentOptions.excludeObjectTypes.value?.find(
            (o) => o.toLowerCase() === optionName.toLowerCase(),
        );

        return isFound === undefined ? true : false;
    };

    return (
        <Drawer
            separator
            open={props.show}
            onOpenChange={(_, { open: show }) => props.showDrawer(show)}
            position="end"
            size="medium">
            <DrawerHeader>
                <DrawerHeaderTitle
                    action={
                        <Button
                            appearance="subtle"
                            aria-label={loc.schemaCompare.close}
                            icon={<Dismiss24Regular />}
                            onClick={() => props.showDrawer(false)}
                        />
                    }>
                    {loc.schemaCompare.schemaCompareOptions}
                </DrawerHeaderTitle>
            </DrawerHeader>
            <DrawerBody>
                <TabList selectedValue={selectedValue} onTabSelect={onTabSelect}>
                    <Tab id="GeneralOptions" value="generalOptions">
                        {loc.schemaCompare.generalOptions}
                    </Tab>
                    <Tab id="IncludeObjectTypes" value="includeObjectTypes">
                        {loc.schemaCompare.includeObjectTypes}
                    </Tab>
                </TabList>
                {selectedValue === "generalOptions" && (
                    <Accordion collapsible multiple defaultOpenItems={["0", "1"]}>
                        <AccordionItem value="0">
                            <AccordionHeader>{loc.schemaCompare.settings}</AccordionHeader>
                            <AccordionPanel className={classes.generalOptionsContainer}>
                                <List>
                                    {optionsToValueNameLookup &&
                                        generalOptionEntries.map(([key, value]) => {
                                            return (
                                                <ListItem
                                                    key={key}
                                                    value={key}
                                                    aria-label={value.displayName}>
                                                    <Checkbox
                                                        checked={value.value}
                                                        onChange={() => handleSettingChanged(key)}
                                                    />
                                                    <Label
                                                        aria-label={value.displayName}
                                                        onClick={() =>
                                                            setDescription(value.description)
                                                        }>
                                                        {value.displayName}
                                                    </Label>
                                                </ListItem>
                                            );
                                        })}
                                </List>
                            </AccordionPanel>
                        </AccordionItem>
                        <AccordionItem value="1">
                            <AccordionHeader>{loc.schemaCompare.description}</AccordionHeader>
                            {!!description && <AccordionPanel>{description}</AccordionPanel>}
                        </AccordionItem>
                    </Accordion>
                )}
                {selectedValue === "includeObjectTypes" && (
                    <List className={classes.objectTypesContainer}>
                        {includeObjectTypesLookup &&
                            includeObjectTypesEntries.map(([key, value]) => {
                                return (
                                    <ListItem key={key} value={key} aria-label={value}>
                                        <Checkbox
                                            checked={handleSetObjectTypesCheckedState(key)}
                                            onChange={() => handleObjectTypesOptionChanged(key)}
                                        />
                                        <Label aria-label={value}>{value}</Label>
                                    </ListItem>
                                );
                            })}
                    </List>
                )}
            </DrawerBody>
            <DrawerFooter>
                <Button appearance="secondary" onClick={() => context.resetOptions()}>
                    {loc.schemaCompare.reset}
                </Button>
                <Button
                    appearance="primary"
                    onClick={() => {
                        context.confirmSchemaOptions(optionsChanged);
                        props.showDrawer(false);
                    }}>
                    {loc.schemaCompare.ok}
                </Button>
                <Button appearance="secondary" onClick={() => props.showDrawer(false)}>
                    {loc.schemaCompare.cancel}
                </Button>
            </DrawerFooter>
        </Drawer>
    );
};

export default SchemaOptionsDrawer;
