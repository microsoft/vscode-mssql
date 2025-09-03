/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import { Button } from "@fluentui/react-components";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { FormField, useFormStyles } from "../../common/forms/form.component";
import {
    ConnectionDialogContextProps,
    ConnectionDialogFormItemSpec,
    ConnectionDialogWebviewState,
    IConnectionDialogProfile,
} from "../../../sharedInterfaces/connectionDialog";
import {
    SearchableDropdown,
    SearchableDropdownOptions,
} from "../../common/searchableDropdown.component";
import { IConnectionGroup } from "../../../sharedInterfaces/connectionGroup";
import { ConnectButton } from "./components/connectButton.component";
import { locConstants } from "../../common/locConstants";
import { AdvancedOptionsDrawer } from "./components/advancedOptionsDrawer.component";

export const ConnectionFormPage = () => {
    const context = useContext(ConnectionDialogContext);
    const [isAdvancedDrawerOpen, setIsAdvancedDrawerOpen] = useState(false);
    const formStyles = useFormStyles();

    if (context === undefined) {
        return undefined;
    }

    // Helper to flatten group hierarchy for dropdown, excluding ROOT group
    function getGroupOptions(): SearchableDropdownOptions[] {
        if (!context?.state?.connectionGroups) return [];
        // Find the root group id (assuming name is "ROOT")
        const rootGroup = context.state.connectionGroups.find((g) => g.name === "ROOT");
        const rootGroupId = rootGroup?.id;
        // Recursively build hierarchical options, skipping ROOT
        function buildOptions(
            groups: IConnectionGroup[],
            parentId?: string,
            prefix: string = "",
        ): SearchableDropdownOptions[] {
            return groups
                .filter((g) => g.parentId === parentId && g.id !== rootGroupId && g.name !== "ROOT")
                .flatMap((g) => {
                    const label = prefix ? `${prefix} / ${g.name}` : g.name;
                    const children = buildOptions(groups, g.id, label);
                    return [{ key: g.id, text: label, value: g.id }, ...children];
                });
        }

        // Start from rootGroupId if available, otherwise undefined
        return buildOptions(context.state.connectionGroups, rootGroupId ?? undefined);
    }

    // Selected group state
    const [selectedGroup, setSelectedGroup] = useState<string>(getGroupOptions()[0]?.value ?? "");

    return (
        <div>
            {/* Connection Group Dropdown */}
            {/* <div style={{ marginBottom: 16 }}>
                <label
                    htmlFor="connection-group-dropdown"
                    style={{ fontWeight: 500, marginRight: 8 }}>
                    Connection Group:
                </label>
                <SearchableDropdown
                    id="connection-group-dropdown"
                    options={getGroupOptions()}
                    selectedOption={getGroupOptions().find((o) => o.value === selectedGroup)}
                    onSelect={(option: SearchableDropdownOptions) => setSelectedGroup(option.value)}
                    placeholder="Select a group"
                />
            </div> */}
            {/* Existing connection form fields */}
            {context.state.connectionComponents.mainOptions.map((inputName, idx) => {
                const component =
                    context.state.formComponents[inputName as keyof IConnectionDialogProfile];
                if (component?.hidden !== false) {
                    return undefined;
                }
                return (
                    <FormField<
                        IConnectionDialogProfile,
                        ConnectionDialogWebviewState,
                        ConnectionDialogFormItemSpec,
                        ConnectionDialogContextProps
                    >
                        key={idx}
                        context={context}
                        component={component}
                        idx={idx}
                        props={{ orientation: "horizontal" }}
                    />
                );
            })}
            <AdvancedOptionsDrawer
                isAdvancedDrawerOpen={isAdvancedDrawerOpen}
                setIsAdvancedDrawerOpen={setIsAdvancedDrawerOpen}
            />
            <div className={formStyles.formNavTray}>
                <Button
                    onClick={(_event) => {
                        setIsAdvancedDrawerOpen(!isAdvancedDrawerOpen);
                    }}
                    className={formStyles.formNavTrayButton}>
                    {locConstants.connectionDialog.advancedSettings}
                </Button>
                <div className={formStyles.formNavTrayRight}>
                    <ConnectButton className={formStyles.formNavTrayButton} />
                </div>
            </div>
        </div>
    );
};
