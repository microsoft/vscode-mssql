/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChangeEvent, useContext, useEffect, useState } from "react";
import {
    Dropdown,
    Input,
    InputOnChangeData,
    Label,
    Menu,
    MenuButton,
    MenuCheckedValueChangeData,
    MenuCheckedValueChangeEvent,
    MenuItemRadio,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Option,
    OptionOnSelectData,
    SelectionEvents,
    Tooltip,
} from "@fluentui/react-components";
import { Search20Regular } from "@fluentui/react-icons";
import { ColorThemeKind } from "../../../../sharedInterfaces/webview";
import { themeType } from "../../../common/utils";
import { ConnectionDialogContext } from "../connectionDialogStateProvider";
import { locConstants as Loc } from "../../../common/locConstants";
import { IAzureTenant } from "../../../../sharedInterfaces/connectionDialog";

interface Props {
    onSearchInputChanged: (_: ChangeEvent<HTMLInputElement>, data: InputOnChangeData) => void;
    onFilterOptionChanged: (
        _: MenuCheckedValueChangeEvent,
        { name, checkedItems }: MenuCheckedValueChangeData,
    ) => void;
    selectTenantId: (tenantId: string) => void;
    searchValue?: string;
    selectedTypeFilters?: string[];
    azureTenants: IAzureTenant[];
    selectedTenantId: string | undefined;
}

export const filterIcon = (colorTheme: ColorThemeKind) => {
    const theme = themeType(colorTheme);
    const filterIcon =
        theme === "dark"
            ? require("../../../media/filter_inverse.svg")
            : require("../../../media/filter.svg");
    return filterIcon;
};

const FabricWorkspaceFilter = ({
    onSearchInputChanged,
    onFilterOptionChanged,
    selectTenantId,
    searchValue = "",
    selectedTypeFilters = [],
    azureTenants = [],
    selectedTenantId = "",
}: Props) => {
    const context = useContext(ConnectionDialogContext);
    const theme = context!.themeKind;

    // const [selectedAccountId, setSelectedAccountId] = useState<string>("");
    const [selectedTenantName, setSelectedTenantName] = useState<string>("");

    // Load accounts from state when component mounts
    useEffect(() => {
        if (selectedTenantId) {
            const tenant = azureTenants.find((t) => t.id === selectedTenantId);
            if (tenant) {
                setSelectedTenantName(tenant.name);
            }
        }
    }, [selectedTenantId]);

    function handleTenantChange(_event: SelectionEvents, data: OptionOnSelectData) {
        const tenantName = data.optionText || "";
        const tenantId = data.optionValue || "";
        setSelectedTenantName(tenantName);

        selectTenantId(tenantId);
    }

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "row",
                justifyContent: "flex-end",
                alignItems: "center",
                marginRight: "6px",
            }}>
            <Label>Tenant</Label>
            <Dropdown
                value={selectedTenantName}
                selectedOptions={selectedTenantId ? [selectedTenantId] : []}
                onOptionSelect={handleTenantChange}
                placeholder="Select a tenant">
                {azureTenants.map((tenant) => (
                    <Option key={tenant.id} value={tenant.id} text={tenant.name}>
                        {tenant.name}
                    </Option>
                ))}
            </Dropdown>
            <Input
                style={{ marginRight: "20px" }}
                placeholder={Loc.connectionDialog.filterByKeyword}
                contentAfter={<Search20Regular aria-label={Loc.connectionDialog.filterByKeyword} />}
                onChange={onSearchInputChanged}
                value={searchValue}
            />
            <Label style={{ marginRight: "5px" }}>{Loc.connectionDialog.filter}</Label>
            <Menu>
                <MenuTrigger>
                    <Tooltip content={Loc.connectionDialog.filterByType} relationship="label">
                        <MenuButton
                            icon={
                                <img
                                    src={filterIcon(theme)}
                                    alt={Loc.connectionDialog.filter}
                                    style={{ width: "20px", height: "20px" }}
                                />
                            }
                        />
                    </Tooltip>
                </MenuTrigger>
                <MenuPopover>
                    <MenuList
                        checkedValues={{ sqlType: selectedTypeFilters }}
                        onCheckedValueChange={onFilterOptionChanged}>
                        <MenuItemRadio name="sqlType" value={Loc.connectionDialog.showAll}>
                            {Loc.connectionDialog.showAll}
                        </MenuItemRadio>
                        <MenuItemRadio
                            name="sqlType"
                            value={Loc.connectionDialog.sqlAnalyticsEndpoint}>
                            {Loc.connectionDialog.sqlAnalyticsEndpoint}
                        </MenuItemRadio>
                        <MenuItemRadio name="sqlType" value={Loc.connectionDialog.sqlDatabase}>
                            {Loc.connectionDialog.sqlDatabase}
                        </MenuItemRadio>
                    </MenuList>
                </MenuPopover>
            </Menu>
        </div>
    );
};

export default FabricWorkspaceFilter;
