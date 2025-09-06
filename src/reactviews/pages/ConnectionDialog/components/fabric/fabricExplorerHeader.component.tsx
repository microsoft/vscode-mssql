/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BaseSyntheticEvent, useEffect, useState } from "react";
import {
    Dropdown,
    Input,
    Label,
    Option,
    OptionOnSelectData,
    SelectionEvents,
    makeStyles,
} from "@fluentui/react-components";
import { DismissRegular, Search20Regular } from "@fluentui/react-icons";
import { ApiStatus, ColorThemeKind } from "../../../../../sharedInterfaces/webview";
import { themeType } from "../../../../common/utils";
import { locConstants as Loc } from "../../../../common/locConstants";
import { IAzureAccount, IAzureTenant } from "../../../../../sharedInterfaces/connectionDialog";
import { addNewMicrosoftAccount } from "../../../../common/constants";
import { Keys } from "../../../../common/keys";

const FabricExplorerHeader = ({
    onSignIntoMicrosoftAccount,
    onSelectAccountId,
    onSelectTenantId,
    onSearchValueChanged,
    searchValue = "",
    selectedTypeFilters: _selectedTypeFilters = [],
    azureAccounts = [],
    selectedAccountId = "",
    azureTenants = [],
    selectedTenantId = "",
    azureTenantsLoadStatus = ApiStatus.NotStarted,
}: FabricBrowserHeaderProps) => {
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
        if (data.optionValue === addNewMicrosoftAccount) {
            onSignIntoMicrosoftAccount();
            return;
        }

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

    function handleSearchValueChanged(value: string, e: BaseSyntheticEvent) {
        onSearchValueChanged(value);
        e?.stopPropagation();
    }

    return (
        <div className={styles.headerContainer}>
            <div className={styles.dropdownContainer}>
                <div className={styles.dropdownGroup}>
                    <Label className={styles.dropdownLabel}>{Loc.connectionDialog.account}</Label>
                    <Dropdown
                        className={styles.compactDropdown}
                        value={selectedAccountName}
                        selectedOptions={selectedAccountId ? [selectedAccountId] : []}
                        onOptionSelect={handleAccountChange}
                        placeholder={Loc.connectionDialog.selectAnAccount}
                        size="small">
                        <Option
                            text={Loc.fabric.addFabricAccount}
                            key={addNewMicrosoftAccount}
                            value={addNewMicrosoftAccount}>
                            {Loc.azure.addAzureAccount}
                        </Option>
                        {azureAccounts.map((account) => (
                            <Option key={account.id} value={account.id} text={account.name}>
                                {account.name}
                            </Option>
                        ))}
                    </Dropdown>
                </div>
                <div className={styles.dropdownGroup}>
                    <Label className={styles.dropdownLabel}>{Loc.azure.tenant}</Label>
                    <Dropdown
                        className={styles.compactDropdown}
                        value={
                            azureTenantsLoadStatus === ApiStatus.Loading
                                ? undefined
                                : selectedTenantName
                        }
                        selectedOptions={selectedTenantId ? [selectedTenantId] : []}
                        onOptionSelect={handleTenantChange}
                        placeholder={
                            azureTenantsLoadStatus === ApiStatus.Loading
                                ? Loc.azure.loadingTenants
                                : Loc.azure.selectATenant
                        }
                        disabled={azureTenantsLoadStatus === ApiStatus.Loading}
                        size="small">
                        {azureTenants.map((tenant) => (
                            <Option key={tenant.id} value={tenant.id} text={tenant.name}>
                                {tenant.name}
                            </Option>
                        ))}
                    </Dropdown>
                </div>
            </div>
            <div className={styles.searchAndFilterSection}>
                <Input
                    className={styles.inputSection}
                    placeholder={Loc.connectionDialog.filterByKeyword}
                    contentBefore={
                        <Search20Regular aria-label={Loc.connectionDialog.filterByKeyword} />
                    }
                    contentAfter={
                        <DismissRegular
                            style={{
                                cursor: "pointer",
                                visibility: searchValue ? "visible" : "hidden",
                            }}
                            onClick={(e) => handleSearchValueChanged("", e)}
                            onKeyDown={(e) => {
                                if (e.key === Keys.Enter) {
                                    handleSearchValueChanged("", e);
                                }
                            }}
                            aria-label={Loc.common.clear}
                            title={Loc.common.clear}
                            role="button"
                            tabIndex={searchValue ? 0 : -1}
                        />
                    }
                    onChange={(e, data) => handleSearchValueChanged(data.value, e)}
                    value={searchValue}
                />
            </div>
        </div>
    );
};

export default FabricExplorerHeader;

interface FabricBrowserHeaderProps {
    onSignIntoMicrosoftAccount: () => void;
    onSelectAccountId: (accountId: string) => void;
    onSelectTenantId: (tenantId: string) => void;
    onSearchValueChanged: (searchValue: string) => void;
    azureAccounts: IAzureAccount[];
    azureTenants: IAzureTenant[];
    selectedAccountId: string | undefined;
    selectedTenantId: string | undefined;
    azureTenantsLoadStatus: ApiStatus;
    searchValue?: string;
    selectedTypeFilters?: string[];
}

export const filterIcon = (colorTheme: ColorThemeKind) => {
    const theme = themeType(colorTheme);
    const filterIcon =
        theme === "dark"
            ? require("../../../../media/filter_inverse.svg")
            : require("../../../../media/filter.svg");
    return filterIcon;
};

const useStyles = makeStyles({
    headerContainer: {
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-end",
        padding: "8px",
        minWidth: 0,
    },
    dropdownContainer: {
        display: "flex",
        flexDirection: "row",
        gap: "12px",
        alignItems: "flex-start",
        flexShrink: 0,
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
        flex: 1,
        minWidth: 0,
        width: "100%",
        fontSize: "12px",
    },
    searchAndFilterSection: {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        flex: 1,
        minWidth: 0,
        marginLeft: "8px",
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
