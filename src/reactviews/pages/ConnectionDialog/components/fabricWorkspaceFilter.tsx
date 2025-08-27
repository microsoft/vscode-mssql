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
    makeStyles,
} from "@fluentui/react-components";
import { Search20Regular } from "@fluentui/react-icons";
import { ColorThemeKind } from "../../../../sharedInterfaces/webview";
import { themeType } from "../../../common/utils";
import { ConnectionDialogContext } from "../connectionDialogStateProvider";
import { locConstants as Loc } from "../../../common/locConstants";
import { IAzureAccount, IAzureTenant } from "../../../../sharedInterfaces/connectionDialog";

const FabricWorkspaceFilter = ({
    onSearchInputChanged,
    onFilterOptionChanged,
    onSelectAccountId,
    onSelectTenantId,
    searchValue = "",
    selectedTypeFilters = [],
    azureAccounts = [],
    azureTenants = [],
    selectedAccountId = "",
    selectedTenantId = "",
}: FabricExplorerFilterProps) => {
    const context = useContext(ConnectionDialogContext);
    const theme = context!.themeKind;
    const styles = useStyles();

    const [selectedAccountName, setSelectedAccountName] = useState<string>("");
    const [selectedTenantName, setSelectedTenantName] = useState<string>("");

    // Load accounts from state when component mounts
    useEffect(() => {
        if (selectedAccountId) {
            const account = azureAccounts.find((a) => a.id === selectedAccountId);
            if (account) {
                handleAccountChange({} as SelectionEvents, {
                    optionText: account.name,
                    optionValue: account.id,
                    selectedOptions: [account.id],
                });
            }
        }
    }, [selectedAccountId]);

    // Load tenants from state when component mounts
    useEffect(() => {
        if (selectedTenantId) {
            const tenant = azureTenants.find((t) => t.id === selectedTenantId);
            if (tenant) {
                handleTenantChange({} as SelectionEvents, {
                    optionText: tenant.name,
                    optionValue: tenant.id,
                    selectedOptions: [tenant.id],
                });
            }
        }
    }, [selectedTenantId]);

    function handleAccountChange(_event: SelectionEvents, data: OptionOnSelectData) {
        const accountName = data.optionText || "";
        const accountId = data.optionValue || "";
        setSelectedAccountName(accountName);
        onSelectAccountId(accountId);
    }

    function handleTenantChange(_event: SelectionEvents, data: OptionOnSelectData) {
        const tenantName = data.optionText || "";
        const tenantId = data.optionValue || "";
        setSelectedTenantName(tenantName);
        onSelectTenantId(tenantId);
    }

    return (
        <div className={styles.headerContainer}>
            <div className={styles.dropdownContainer}>
                <div className={styles.dropdownGroup}>
                    <Label className={styles.dropdownLabel}>Account</Label>
                    <Dropdown
                        className={styles.compactDropdown}
                        value={selectedAccountName}
                        selectedOptions={selectedAccountId ? [selectedAccountId] : []}
                        onOptionSelect={handleAccountChange}
                        placeholder="Select an account"
                        size="small">
                        {azureAccounts.map((account) => (
                            <Option key={account.id} value={account.id} text={account.name}>
                                {account.name}
                            </Option>
                        ))}
                    </Dropdown>
                </div>
                <div className={styles.dropdownGroup}>
                    <Label className={styles.dropdownLabel}>Tenant</Label>
                    <Dropdown
                        className={styles.compactDropdown}
                        value={selectedTenantName}
                        selectedOptions={selectedTenantId ? [selectedTenantId] : []}
                        onOptionSelect={handleTenantChange}
                        placeholder="Select a tenant"
                        size="small">
                        {azureTenants.map((tenant) => (
                            <Option key={tenant.id} value={tenant.id} text={tenant.name}>
                                {tenant.name}
                            </Option>
                        ))}
                    </Dropdown>
                </div>
            </div>
            <div className={styles.filterSection}>
                <Label className={styles.filterLabel}>{Loc.connectionDialog.filter}</Label>
                <Menu>
                    <MenuTrigger>
                        <Tooltip content={Loc.connectionDialog.filterByType} relationship="label">
                            <MenuButton
                                icon={
                                    <img
                                        src={filterIcon(theme)}
                                        alt={Loc.connectionDialog.filter}
                                        className={styles.filterIcon}
                                    />
                                }
                                appearance="subtle"
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
        </div>
    );
};

export default FabricWorkspaceFilter;

interface FabricExplorerFilterProps {
    onSelectAccountId: (accountId: string) => void;
    onSelectTenantId: (tenantId: string) => void;
    onSearchInputChanged: (_: ChangeEvent<HTMLInputElement>, data: InputOnChangeData) => void;
    onFilterOptionChanged: (
        _: MenuCheckedValueChangeEvent,
        { name, checkedItems }: MenuCheckedValueChangeData,
    ) => void;

    azureAccounts: IAzureAccount[];
    azureTenants: IAzureTenant[];
    selectedAccountId: string | undefined;
    selectedTenantId: string | undefined;
    searchValue?: string;
    selectedTypeFilters?: string[];
}

export const filterIcon = (colorTheme: ColorThemeKind) => {
    const theme = themeType(colorTheme);
    const filterIcon =
        theme === "dark"
            ? require("../../../media/filter_inverse.svg")
            : require("../../../media/filter.svg");
    return filterIcon;
};

const useStyles = makeStyles({
    headerContainer: {
        display: "flex",
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "flex-start",
        padding: "8px",
    },
    dropdownContainer: {
        display: "flex",
        flexDirection: "row",
        gap: "12px",
        alignItems: "flex-start",
    },
    dropdownGroup: {
        display: "flex",
        flexDirection: "column",
        width: "200px",
        flexShrink: 0,
    },
    dropdownLabel: {
        fontSize: "12px",
        marginBottom: "4px",
        display: "block",
    },
    compactDropdown: {
        width: "200px",
        minWidth: "200px",
        fontSize: "12px",
        "& .fui-Dropdown__button": {
            fontSize: "12px",
            minHeight: "24px",
            padding: "4px 8px",
        },
        "& .fui-Option": {
            fontSize: "12px",
            minHeight: "24px",
        },
    },
    inputSection: {
        marginRight: "20px",
    },
    filterSection: {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        flexShrink: 0,
    },
    filterLabel: {
        marginRight: "5px",
        fontSize: "12px",
        marginBottom: "4px",
        display: "block",
    },
    filterIcon: {
        width: "20px",
        height: "20px",
    },
});
