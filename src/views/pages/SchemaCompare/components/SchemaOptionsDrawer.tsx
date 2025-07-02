/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import {
    Button,
    Checkbox,
    Drawer,
    DrawerBody,
    DrawerFooter,
    DrawerHeader,
    DrawerHeaderTitle,
    InfoLabel,
    Label,
    makeStyles,
    SearchBox,
    SelectTabData,
    SelectTabEvent,
    Tab,
    TabList,
    TabValue,
    List,
    ListItem,
} from "@fluentui/react-components";
import { Dismiss24Regular } from "@fluentui/react-icons";
import { locConstants as loc } from "../../../common/locConstants";
import { schemaCompareContext } from "../SchemaCompareStateProvider";
import { DacDeployOptionPropertyBoolean } from "vscode-mssql";

const useStyles = makeStyles({
    optionsContainer: {
        height: "75vh",
        overflowY: "auto",
    },

    listItemContainer: {
        display: "flex",
        alignItems: "center",
    },

    searchContainer: {
        margin: "10px 0",
        width: "100%",
    },
});

interface Props {
    show: boolean;
    showDrawer: (show: boolean) => void;
}

const SchemaOptionsDrawer = (props: Props) => {
    const classes = useStyles();
    const context = useContext(schemaCompareContext);
    const [optionsChanged, setOptionsChanged] = useState(false);
    const [selectedValue, setSelectedValue] = useState<TabValue>("generalOptions");
    const [searchQuery, setSearchQuery] = useState("");

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

    const filteredGeneralOptions = generalOptionEntries.filter(
        ([_, value]) =>
            searchQuery === "" ||
            value.displayName.toLowerCase().includes(searchQuery.toLowerCase()),
    );

    const filteredObjectTypes = includeObjectTypesEntries.filter(
        ([_, value]) =>
            searchQuery === "" || value.toLowerCase().includes(searchQuery.toLowerCase()),
    );

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
                <SearchBox
                    className={classes.searchContainer}
                    placeholder={loc.schemaCompare.searchOptions}
                    value={searchQuery}
                    onChange={(_, data) => setSearchQuery(data.value)}
                />

                <TabList selectedValue={selectedValue} onTabSelect={onTabSelect}>
                    <Tab id="GeneralOptions" value="generalOptions">
                        {loc.schemaCompare.generalOptions}
                    </Tab>
                    <Tab id="IncludeObjectTypes" value="includeObjectTypes">
                        {loc.schemaCompare.includeObjectTypes}
                    </Tab>
                </TabList>

                {selectedValue === "generalOptions" && (
                    <List className={classes.optionsContainer}>
                        {optionsToValueNameLookup &&
                            filteredGeneralOptions.map(([key, value]) => {
                                return (
                                    <ListItem
                                        className={classes.listItemContainer}
                                        key={key}
                                        value={key}
                                        aria-label={value.displayName}>
                                        <Checkbox
                                            checked={value.value}
                                            onChange={() => handleSettingChanged(key)}
                                            label={
                                                <InfoLabel
                                                    aria-label={value.displayName}
                                                    info={<>{value.description}</>}>
                                                    {value.displayName}
                                                </InfoLabel>
                                            }
                                        />
                                    </ListItem>
                                );
                            })}
                    </List>
                )}

                {selectedValue === "includeObjectTypes" && (
                    <List className={classes.optionsContainer}>
                        {includeObjectTypesLookup &&
                            filteredObjectTypes.map(([key, value]) => {
                                return (
                                    <ListItem
                                        className={classes.listItemContainer}
                                        key={key}
                                        value={key}
                                        aria-label={value}>
                                        <Checkbox
                                            checked={handleSetObjectTypesCheckedState(key)}
                                            onChange={() => handleObjectTypesOptionChanged(key)}
                                            label={<Label aria-label={value}>{value}</Label>}
                                        />
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
