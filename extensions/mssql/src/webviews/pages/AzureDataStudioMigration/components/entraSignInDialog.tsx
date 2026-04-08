/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Dropdown,
    Link,
    Option,
    Text,
    makeStyles,
} from "@fluentui/react-components";
import { useEffect, useMemo, useState } from "react";

import {
    EntraAccountTenantOption,
    EntraSignInDialogProps,
} from "../../../../sharedInterfaces/azureDataStudioMigration";
import { locConstants as Loc } from "../../../common/locConstants";

const useStyles = makeStyles({
    contentStack: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        marginTop: "12px",
    },
    summaryStack: {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        marginTop: "12px",
    },
    label: {
        fontWeight: 600,
        marginBottom: "4px",
    },
    dropdown: {
        width: "450px",
    },
    codeInline: {
        fontFamily: "var(--vscode-editor-font-family, monospace)",
        backgroundColor: "var(--vscode-textCodeBlock-background)",
        color: "var(--vscode-textCodeBlock-foreground)",
        borderRadius: "2px",
        padding: "4px",
    },
});

interface EntraSignInDialogComponentProps {
    dialog: EntraSignInDialogProps;
    onSignIn: (connectionId: string) => void;
    onSelectAccount: (connectionId: string, accountId: string, tenantId: string) => void;
    onCancel: () => void;
}

export const EntraSignInDialog = ({
    dialog,
    onSignIn,
    onSelectAccount,
    onCancel,
}: EntraSignInDialogComponentProps) => {
    const styles = useStyles();
    const loc = Loc.azureDataStudioMigration;

    const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>(
        dialog.entraAuthAccounts[0]?.id,
    );
    const [selectedTenantId, setSelectedTenantId] = useState<string | undefined>(
        dialog.entraAuthAccounts[0]?.tenants?.[0]?.id,
    );

    useEffect(() => {
        setSelectedAccountId(dialog.entraAuthAccounts[0]?.id);
        setSelectedTenantId(dialog.entraAuthAccounts[0]?.tenants?.[0]?.id);
    }, [dialog.entraAuthAccounts]);

    const selectedAccount = useMemo(() => {
        return dialog.entraAuthAccounts.find((acct) => acct.id === selectedAccountId);
    }, [dialog.entraAuthAccounts, selectedAccountId]);

    const selectedTenant = useMemo(() => {
        return selectedAccount?.tenants?.find((tenant) => tenant.id === selectedTenantId);
    }, [selectedAccount, selectedTenantId]);

    const formatTenantDisplay = (tenant?: EntraAccountTenantOption) => {
        if (!tenant) {
            return "";
        }

        const name = tenant.displayName ?? tenant.id;
        return `${name} (${tenant.id})`;
    };

    const handleAccountChange = (accountId: string) => {
        setSelectedAccountId(accountId);
        const fallbackTenant = dialog.entraAuthAccounts.find((acct) => acct.id === accountId)
            ?.tenants?.[0]?.id;
        setSelectedTenantId(fallbackTenant);
    };

    const handleTenantChange = (tenantId: string) => {
        setSelectedTenantId(tenantId);
    };

    const isSelectionValid = Boolean(selectedAccountId && selectedTenantId);

    return (
        <Dialog open>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>{Loc.azureDataStudioMigration.entraSignInDialogTitle}</DialogTitle>
                    <DialogContent>
                        <Text>{Loc.azureDataStudioMigration.entraSignInDialogMessage}</Text>
                        <div className={styles.summaryStack}>
                            <Text>
                                <strong>{loc.entraSignInAccountLabel}:</strong>{" "}
                                {dialog.originalEntraAccount}
                            </Text>
                            <Text>
                                <strong>{loc.entraSignInTenantLabel}:</strong>{" "}
                                <span className={styles.codeInline}>
                                    {dialog.originalEntraTenantId}
                                </span>
                            </Text>
                        </div>
                        <div className={styles.contentStack}>
                            <div>
                                <div className={styles.label}>{loc.entraSignInAccountLabel}</div>
                                <Dropdown
                                    className={styles.dropdown}
                                    value={selectedAccount?.displayName ?? ""}
                                    selectedOptions={selectedAccountId ? [selectedAccountId] : []}
                                    onOptionSelect={(_, data) =>
                                        handleAccountChange(data.optionValue as string)
                                    }>
                                    {dialog.entraAuthAccounts.map((account) => (
                                        <Option key={account.id} value={account.id}>
                                            {account.displayName}
                                        </Option>
                                    ))}
                                </Dropdown>
                            </div>
                            <div>
                                <div className={styles.label}>{loc.entraSignInTenantLabel}</div>
                                <Dropdown
                                    disabled={!selectedAccount?.tenants.length}
                                    className={styles.dropdown}
                                    value={formatTenantDisplay(selectedTenant)}
                                    selectedOptions={selectedTenantId ? [selectedTenantId] : []}
                                    onOptionSelect={(_, data) =>
                                        handleTenantChange(data.optionValue as string)
                                    }>
                                    {selectedAccount?.tenants.map((tenant) => {
                                        const tenantDisplay = formatTenantDisplay(tenant);
                                        return (
                                            <Option key={tenant.id} value={tenant.id}>
                                                {tenantDisplay}
                                            </Option>
                                        );
                                    })}
                                </Dropdown>
                            </div>
                            <Link onClick={() => onSignIn(dialog.connectionId)}>
                                {loc.entraSignInLink}
                            </Link>
                        </div>
                    </DialogContent>
                    <DialogActions>
                        <Button appearance="secondary" onClick={onCancel}>
                            {Loc.common.cancel}
                        </Button>
                        <Button
                            appearance="primary"
                            disabled={!isSelectionValid}
                            onClick={() => {
                                if (selectedAccountId && selectedTenantId) {
                                    onSelectAccount(
                                        dialog.connectionId,
                                        selectedAccountId,
                                        selectedTenantId,
                                    );
                                }
                            }}>
                            {Loc.azureDataStudioMigration.selectAccount}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
