/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Button,
    Checkbox,
    Drawer,
    DrawerBody,
    DrawerFooter,
    DrawerHeader,
    DrawerHeaderTitle,
    Field,
    Input,
    Link,
    SearchBox,
    Tab,
    TabList,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableHeaderCell,
    TableRow,
    Text,
    makeStyles,
} from "@fluentui/react-components";
import { AddRegular, Dismiss16Regular, Dismiss24Regular } from "@fluentui/react-icons";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
    ObjectManagementSearchParams,
    ObjectManagementSearchResult,
    ObjectManagementSearchResultItem,
    SecurablePermissionItem,
    SecurablePermissions,
    SecurableTypeMetadata,
    UserType,
    UserViewModel,
} from "../../../sharedInterfaces/objectManagement";
import { locConstants } from "../../common/locConstants";
import { SearchableDropdown } from "../../common/searchableDropdown.component";

const useStyles = makeStyles({
    tabList: {
        borderBottom: "1px solid var(--vscode-editorGroup-border)",
        marginBottom: "16px",
    },
    tabContent: {
        display: "flex",
        flexDirection: "column",
        gap: "20px",
    },
    sectionBlock: {
        display: "flex",
        flexDirection: "column",
        gap: "10px",
    },
    sectionHeader: {
        fontSize: "11px",
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        color: "var(--vscode-descriptionForeground)",
    },
    sectionDescription: {
        fontSize: "12px",
        color: "var(--vscode-descriptionForeground)",
    },
    sectionTitle: {
        fontSize: "12px",
        fontWeight: "600",
        color: "var(--vscode-foreground)",
    },
    identityGrid: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: "16px",
    },
    gridSpan: {
        gridColumn: "1 / -1",
    },
    fieldGroup: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
    },
    searchBox: {
        width: "100%",
    },
    helperText: {
        fontSize: "12px",
        color: "var(--vscode-descriptionForeground)",
    },
    highlight: {
        backgroundColor: "var(--vscode-editor-findMatchHighlightBackground)",
        color: "var(--vscode-editor-findMatchHighlightForeground)",
        borderRadius: "2px",
        padding: "0 2px",
    },
    chipRow: {
        display: "flex",
        flexWrap: "wrap",
        gap: "8px",
    },
    chip: {
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "4px 8px",
        borderRadius: "14px",
        fontSize: "12px",
        backgroundColor: "var(--vscode-badge-background)",
        color: "var(--vscode-badge-foreground)",
    },
    chipRemove: {
        padding: 0,
        minWidth: "unset",
        height: "20px",
    },
    addSchemaRow: {
        display: "flex",
        gap: "8px",
        alignItems: "center",
        flexWrap: "wrap",
    },
    addSchemaSelect: {
        minWidth: "220px",
        flex: "1 1 220px",
    },
    roleSearch: {
        maxWidth: "320px",
    },
    roleList: {
        border: "1px solid var(--vscode-editorGroup-border)",
        borderRadius: "6px",
        backgroundColor: "var(--vscode-editor-background)",
        maxHeight: "200px",
        overflowY: "auto",
        position: "relative",
    },
    roleInner: {
        position: "relative",
        width: "100%",
    },
    roleRow: {
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(140px, 1fr))",
        gap: "12px",
        padding: "6px 10px",
        borderBottom: "1px solid var(--vscode-editorGroup-border)",
    },
    roleRowLast: {
        borderBottom: "none",
    },
    roleCell: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        fontSize: "12px",
        color: "var(--vscode-foreground)",
    },
    previewHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
    },
    previewLink: {
        fontSize: "12px",
    },
    permissionTags: {
        display: "flex",
        flexWrap: "wrap",
        gap: "4px",
    },
    permissionTag: {
        fontSize: "10px",
        padding: "2px 6px",
        borderRadius: "4px",
        textTransform: "uppercase",
        fontWeight: "600",
        letterSpacing: "0.3px",
    },
    permissionTagGrant: {
        backgroundColor: "#2d6b2d",
        color: "#b7f5b7",
    },
    permissionTagDeny: {
        backgroundColor: "#6b2d2d",
        color: "#f5b7b7",
    },
    tableToolbar: {
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-start",
        gap: "8px",
    },
    tableSearch: {
        flex: "1 1 240px",
        maxWidth: "360px",
    },
    tableActions: {
        display: "flex",
        justifyContent: "flex-end",
        gap: "8px",
    },
    table: {
        width: "100%",
        borderCollapse: "collapse",
        border: "1px solid var(--vscode-editorGroup-border)",
        backgroundColor: "var(--vscode-editor-background)",
    },
    tableScroll: {
        maxHeight: "280px",
        overflowY: "auto",
    },
    tableHeaderCell: {
        textAlign: "left",
        fontSize: "12px",
        fontWeight: "600",
        padding: "8px 10px",
        color: "var(--vscode-foreground)",
        backgroundColor: "var(--vscode-editorWidget-background)",
        borderBottom: "1px solid var(--vscode-editorGroup-border)",
    },
    tableCell: {
        fontSize: "13px",
        padding: "8px 10px",
        borderBottom: "1px solid var(--vscode-editorGroup-border)",
        color: "var(--vscode-foreground)",
    },
    tableSpacerCell: {
        padding: 0,
        borderBottom: "none",
    },
    tableCellMuted: {
        color: "var(--vscode-descriptionForeground)",
    },
    tableRow: {
        cursor: "pointer",
    },
    tableRowSelected: {
        backgroundColor: "var(--vscode-list-activeSelectionBackground)",
        color: "var(--vscode-list-activeSelectionForeground)",
    },
    tableButtons: {
        display: "flex",
        gap: "8px",
    },
    permissionsGroup: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
    },
    drawerBody: {
        display: "flex",
        flexDirection: "column",
        gap: "16px",
    },
    drawerSection: {
        display: "flex",
        flexDirection: "column",
        gap: "10px",
    },
    selectionCards: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
    },
    selectionCard: {
        border: "1px solid var(--vscode-editorGroup-border)",
        borderRadius: "8px",
        backgroundColor: "var(--vscode-editorWidget-background)",
        padding: "12px",
        display: "grid",
        gridTemplateColumns: "20px 40px 1fr",
        gap: "12px",
        alignItems: "center",
        textAlign: "left",
        cursor: "pointer",
        width: "100%",
        appearance: "none",
        color: "var(--vscode-foreground)",
    },
    selectionCardActive: {
        borderColor: "var(--vscode-focusBorder)",
        boxShadow: "0 0 0 1px var(--vscode-focusBorder) inset",
    },
    selectionRadio: {
        width: "16px",
        height: "16px",
        borderRadius: "50%",
        border: "2px solid var(--vscode-descriptionForeground)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    selectionRadioInner: {
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        backgroundColor: "var(--vscode-focusBorder)",
    },
    selectionIconBox: {
        width: "40px",
        height: "40px",
        borderRadius: "8px",
        backgroundColor: "var(--vscode-button-secondaryBackground)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--vscode-foreground)",
    },
    selectionIconActive: {
        backgroundColor: "rgba(14, 99, 156, 0.6)",
        color: "var(--vscode-foreground)",
    },
    selectionTitle: {
        fontSize: "13px",
        fontWeight: "600",
    },
    selectionDescription: {
        fontSize: "11px",
        color: "var(--vscode-descriptionForeground)",
    },
    filterChips: {
        display: "flex",
        flexWrap: "wrap",
        gap: "6px",
    },
    filterChip: {
        borderRadius: "14px",
        padding: "2px 10px",
        fontSize: "11px",
    },
    filterChipActive: {
        backgroundColor: "var(--vscode-button-secondaryBackground)",
        color: "var(--vscode-foreground)",
    },
    infoCallout: {
        display: "flex",
        gap: "10px",
        padding: "10px",
        borderRadius: "6px",
        backgroundColor: "rgba(55, 148, 255, 0.1)",
        color: "var(--vscode-foreground)",
        fontSize: "11px",
    },
    infoCalloutIcon: {
        width: "18px",
        height: "18px",
        borderRadius: "50%",
        backgroundColor: "var(--vscode-textLink-foreground)",
        color: "var(--vscode-editor-background)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: "700",
        flexShrink: 0,
    },
    addDialogResults: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
    },
    addDialogFooter: {
        display: "flex",
        justifyContent: "space-between",
        gap: "8px",
    },
    badge: {
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 6px",
        borderRadius: "4px",
        fontSize: "11px",
        backgroundColor: "var(--vscode-badge-background)",
        color: "var(--vscode-badge-foreground)",
    },
});

type SearchMethod = "specific" | "types" | "schema";

export interface UserFormState {
    name: string;
    type: UserType;
    loginName?: string;
    password?: string;
    confirmPassword?: string;
    defaultSchema?: string;
    ownedSchemas: string[];
    databaseRoles: string[];
    defaultLanguage?: string;
    securablePermissions: SecurablePermissions[];
}

export interface UserFormProps {
    value: UserFormState;
    viewModel: UserViewModel;
    nameValidationMessage?: string;
    nameValidationState?: "none" | "error";
    loginValidationMessage?: string;
    loginValidationState?: "none" | "error";
    passwordValidationMessage?: string;
    passwordValidationState?: "none" | "error";
    confirmPasswordValidationMessage?: string;
    confirmPasswordValidationState?: "none" | "error";
    onChange: (next: UserFormState) => void;
    onSearchSecurables: (params: ObjectManagementSearchParams) => Promise<ObjectManagementSearchResult>;
}

 

const getUserTypeDisplayName = (userType: UserType) => {
    switch (userType) {
        case "LoginMapped":
            return locConstants.userDialog.userTypeLoginMapped;
        case "WindowsUser":
            return locConstants.userDialog.userTypeWindowsUser;
        case "SqlAuthentication":
            return locConstants.userDialog.userTypeSqlAuth;
        case "AADAuthentication":
            return locConstants.userDialog.userTypeAadAuth;
        case "NoLoginAccess":
            return locConstants.userDialog.userTypeNoLogin;
        default:
            return userType;
    }
};

const getTypeLabel = (type: string, types: SecurableTypeMetadata[]) => {
    const match = types.find((item) => item.name === type);
    return match?.displayName ?? type;
};

const buildSecurableKey = (item: { name?: string; schema?: string; type?: string }) =>
    `${item.type ?? ""}|${item.schema ?? ""}|${item.name ?? ""}`;

const LIST_ROW_HEIGHT = 30;
const TABLE_ROW_HEIGHT = 36;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildSearchTokens = (value: string) =>
    value
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);

const matchesSearch = (text: string, tokens: string[]) => {
    if (tokens.length === 0) {
        return true;
    }
    const lower = text.toLowerCase();
    return tokens.every((token) => lower.includes(token));
};

const renderHighlightedText = (text: string, tokens: string[], className: string) => {
    if (tokens.length === 0) {
        return text;
    }
    const rawTokens = Array.from(new Set(tokens.map((token) => token.toLowerCase())));
    const escapedTokens = Array.from(new Set(tokens.map(escapeRegExp)));
    if (escapedTokens.length === 0) {
        return text;
    }
    const regex = new RegExp(`(${escapedTokens.join("|")})`, "gi");
    const parts = text.split(regex);
    return parts.map((part, index) => {
        const isMatch = rawTokens.some((token) => part.toLowerCase() === token);
        return isMatch ? (
            <span key={`${part}-${index}`} className={className}>
                {part}
            </span>
        ) : (
            <span key={`${part}-${index}`}>{part}</span>
        );
    });
};

export const UserForm = ({
    value,
    viewModel,
    nameValidationMessage,
    nameValidationState,
    loginValidationMessage,
    loginValidationState,
    passwordValidationMessage,
    passwordValidationState,
    confirmPasswordValidationMessage,
    confirmPasswordValidationState,
    onChange,
    onSearchSecurables,
}: UserFormProps) => {
    const styles = useStyles();
    const supportedSecurableTypes = viewModel.supportedSecurableTypes ?? [];

    const updateForm = (patch: Partial<UserFormState>) => {
        onChange({ ...value, ...patch });
    };

    const showLoginField =
        value.type === "LoginMapped" || (value.type === "WindowsUser" && !!value.loginName);
    const showPasswordFields = value.type === "SqlAuthentication";
    const showAdvancedSection =
        value.type === "SqlAuthentication" || value.type === "AADAuthentication";
    const userTypeDisabled = !viewModel.isNewObject;
    const loginDisabled = !viewModel.isNewObject;

    const userTypeOptions = (viewModel.userTypes?.length
        ? viewModel.userTypes
        : (["LoginMapped"] as UserType[])).map((type) => ({
        value: type,
        text: getUserTypeDisplayName(type),
    }));

    const defaultSchemaOptions = (viewModel.schemas ?? []).map((schema) => ({
        value: schema,
        text: schema,
    }));

    const loginOptions = (viewModel.logins ?? []).map((login) => ({
        value: login,
        text: login,
    }));

    const languageOptions = (viewModel.languages ?? []).map((language) => ({
        value: language,
        text: language,
    }));

    const toggleRole = (role: string, checked: boolean) => {
        const roles = new Set(value.databaseRoles ?? []);
        if (checked) {
            roles.add(role);
        } else {
            roles.delete(role);
        }
        updateForm({ databaseRoles: Array.from(roles) });
    };

    const [activeTab, setActiveTab] = useState<"general" | "securables" | "advanced">(
        "general",
    );

    const previewSecurables = value.securablePermissions ?? [];
    const previewLimit = 3;
    const previewRows = previewSecurables.slice(0, previewLimit);
    const previewCount = previewSecurables.length;

    const getPermissionTags = (securable: SecurablePermissions) => {
        const permissions = securable.permissions ?? [];
        return permissions
            .filter((permission) => permission.grant !== undefined)
            .map((permission) => ({
                name: permission.permission,
                isDeny: permission.grant === false,
            }));
    };

    return (
        <div>
            <TabList
                className={styles.tabList}
                selectedValue={activeTab}
                onTabSelect={(_, data) =>
                    setActiveTab(data.value as "general" | "securables" | "advanced")
                }>
                <Tab value="general">{locConstants.userDialog.generalSection}</Tab>
                <Tab value="securables">{locConstants.userDialog.securablesTab}</Tab>
                <Tab value="advanced">{locConstants.userDialog.advancedSection}</Tab>
            </TabList>

            {activeTab === "general" && (
                <div className={styles.tabContent}>
                    <div className={styles.sectionBlock}>
                        <Text className={styles.sectionHeader}>
                            {locConstants.userDialog.identitySection}
                        </Text>
                        <div className={styles.identityGrid}>
                            <Field
                                label={locConstants.userDialog.nameLabel}
                                required
                                validationMessage={nameValidationMessage}
                                validationState={nameValidationState ?? "none"}>
                                <Input
                                    size="medium"
                                    value={value.name}
                                    onChange={(_, data) => updateForm({ name: data.value })}
                                    disabled={!viewModel.isNewObject}
                                />
                            </Field>
                            <Field label={locConstants.userDialog.userTypeLabel}>
                                <SearchableDropdown
                                    options={userTypeOptions}
                                    selectedOption={
                                        value.type
                                            ? {
                                                  value: value.type,
                                                  text: getUserTypeDisplayName(value.type),
                                              }
                                            : undefined
                                    }
                                    onSelect={(option) =>
                                        updateForm({ type: option.value as UserType })
                                    }
                                    ariaLabel={locConstants.userDialog.userTypeLabel}
                                    size="medium"
                                    disabled={userTypeDisabled}
                                />
                            </Field>
                            {showLoginField && (
                                <Field
                                    label={locConstants.userDialog.loginLabel}
                                    validationMessage={loginValidationMessage}
                                    validationState={loginValidationState ?? "none"}>
                                    {loginOptions.length > 0 ? (
                                        <SearchableDropdown
                                            options={loginOptions}
                                            selectedOption={
                                                value.loginName
                                                    ? {
                                                          value: value.loginName,
                                                          text: value.loginName,
                                                      }
                                                    : undefined
                                            }
                                            onSelect={(option) =>
                                                updateForm({ loginName: option.value })
                                            }
                                            ariaLabel={locConstants.userDialog.loginLabel}
                                            size="medium"
                                            disabled={loginDisabled}
                                        />
                                    ) : (
                                        <Input
                                            value={value.loginName ?? ""}
                                            onChange={(_, data) =>
                                                updateForm({ loginName: data.value })
                                            }
                                            disabled={loginDisabled}
                                        />
                                    )}
                                </Field>
                            )}
                            {defaultSchemaOptions.length > 0 && (
                                <Field label={locConstants.userDialog.defaultSchemaLabel}>
                                    <SearchableDropdown
                                        options={defaultSchemaOptions}
                                        selectedOption={
                                            value.defaultSchema
                                                ? {
                                                      value: value.defaultSchema,
                                                      text: value.defaultSchema,
                                                  }
                                                : undefined
                                        }
                                        onSelect={(option) =>
                                            updateForm({ defaultSchema: option.value })
                                        }
                                        ariaLabel={locConstants.userDialog.defaultSchemaLabel}
                                        size="medium"
                                    />
                                </Field>
                            )}
                            {showPasswordFields && (
                                <>
                                    <Field
                                        className={styles.gridSpan}
                                        label={locConstants.userDialog.passwordLabel}
                                        validationMessage={passwordValidationMessage}
                                        validationState={passwordValidationState ?? "none"}>
                                        <Input
                                            type="password"
                                            value={value.password ?? ""}
                                            onChange={(_, data) =>
                                                updateForm({ password: data.value })
                                            }
                                        />
                                    </Field>
                                    <Field
                                        className={styles.gridSpan}
                                        label={locConstants.userDialog.confirmPasswordLabel}
                                        validationMessage={confirmPasswordValidationMessage}
                                        validationState={confirmPasswordValidationState ?? "none"}>
                                        <Input
                                            type="password"
                                            value={value.confirmPassword ?? ""}
                                            onChange={(_, data) =>
                                                updateForm({ confirmPassword: data.value })
                                            }
                                        />
                                    </Field>
                                </>
                            )}
                        </div>
                    </div>

                    <div className={styles.sectionBlock}>
                        <Text className={styles.sectionHeader}>
                            {locConstants.userDialog.schemaOwnershipSection}
                        </Text>
                        <Text className={styles.sectionDescription}>
                            {locConstants.userDialog.schemaOwnershipDescription}
                        </Text>
                        <SchemaOwnershipPicker
                            schemas={viewModel.schemas ?? []}
                            selectedSchemas={value.ownedSchemas ?? []}
                            onChange={(next) => updateForm({ ownedSchemas: next })}
                        />
                    </div>

                    <div className={styles.sectionBlock}>
                        <Text className={styles.sectionHeader}>
                            {locConstants.userDialog.roleMembershipSection}
                        </Text>
                        <Text className={styles.sectionDescription}>
                            {locConstants.userDialog.roleMembershipDescription}
                        </Text>
                        <RoleMembershipGrid
                            roles={viewModel.databaseRoles ?? []}
                            selectedRoles={value.databaseRoles ?? []}
                            onToggle={toggleRole}
                            searchPlaceholder={locConstants.userDialog.searchMembershipPlaceholder}
                        />
                    </div>

                    <div className={styles.sectionBlock}>
                        <div className={styles.previewHeader}>
                            <Text className={styles.sectionHeader}>
                                {locConstants.userDialog.securablesPreviewTitle(previewCount)}
                            </Text>
                            <Link
                                className={styles.previewLink}
                                onClick={() => setActiveTab("securables")}>
                                {locConstants.userDialog.addOrManageSecurables}
                            </Link>
                        </div>
                        <Table role="grid" className={styles.table}>
                            <TableHeader>
                                <TableRow>
                                    <TableHeaderCell className={styles.tableHeaderCell}>
                                        {locConstants.userDialog.objectColumn}
                                    </TableHeaderCell>
                                    <TableHeaderCell className={styles.tableHeaderCell}>
                                        {locConstants.userDialog.schemaColumn}
                                    </TableHeaderCell>
                                    <TableHeaderCell className={styles.tableHeaderCell}>
                                        {locConstants.userDialog.securableTypeColumn}
                                    </TableHeaderCell>
                                    <TableHeaderCell className={styles.tableHeaderCell}>
                                        {locConstants.userDialog.permissionsColumn}
                                    </TableHeaderCell>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {previewRows.length === 0 ? (
                                    <TableRow>
                                        <TableCell
                                            colSpan={4}
                                            className={`${styles.tableCell} ${styles.tableCellMuted}`}>
                                            {locConstants.userDialog.securablesEmpty}
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    previewRows.map((securable) => {
                                        const tags = getPermissionTags(securable);
                                        return (
                                            <TableRow key={buildSecurableKey(securable)}>
                                                <TableCell className={styles.tableCell}>
                                                    {securable.name}
                                                </TableCell>
                                                <TableCell className={styles.tableCell}>
                                                    {securable.schema ??
                                                        locConstants.userDialog.valueUnknown}
                                                </TableCell>
                                                <TableCell className={styles.tableCell}>
                                                    {getTypeLabel(
                                                        securable.type ?? "",
                                                        supportedSecurableTypes,
                                                    )}
                                                </TableCell>
                                                <TableCell className={styles.tableCell}>
                                                    <div className={styles.permissionTags}>
                                                        {tags.length === 0 ? (
                                                            <Text
                                                                className={styles.helperText}>
                                                                {locConstants.userDialog.permissionsEmptyPreview}
                                                            </Text>
                                                        ) : (
                                                            tags.map((tag) => (
                                                                <span
                                                                    key={tag.name}
                                                                    className={`${styles.permissionTag} ${
                                                                        tag.isDeny
                                                                            ? styles.permissionTagDeny
                                                                            : styles.permissionTagGrant
                                                                    }`}>
                                                                    {tag.isDeny
                                                                        ? `DENY ${tag.name}`
                                                                        : tag.name}
                                                                </span>
                                                            ))
                                                        )}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </div>
            )}

            {activeTab === "securables" && (
                <div className={styles.tabContent}>
                    <SecurablesSection
                        securables={value.securablePermissions ?? []}
                        schemas={viewModel.schemas ?? []}
                        supportedSecurableTypes={supportedSecurableTypes}
                        onChange={(next) => updateForm({ securablePermissions: next })}
                        onSearchSecurables={onSearchSecurables}
                    />
                </div>
            )}

            {activeTab === "advanced" && showAdvancedSection && (
                <div className={styles.tabContent}>
                    <div className={styles.sectionBlock}>
                        <Text className={styles.sectionHeader}>
                            {locConstants.userDialog.advancedSection}
                        </Text>
                        <div className={styles.fieldGroup}>
                            {languageOptions.length > 0 && (
                                <Field label={locConstants.userDialog.defaultLanguageLabel}>
                                    <SearchableDropdown
                                        options={languageOptions}
                                        selectedOption={
                                            value.defaultLanguage
                                                ? {
                                                      value: value.defaultLanguage,
                                                      text: value.defaultLanguage,
                                                  }
                                                : undefined
                                        }
                                        onSelect={(option) =>
                                            updateForm({ defaultLanguage: option.value })
                                        }
                                        ariaLabel={locConstants.userDialog.defaultLanguageLabel}
                                        size="medium"
                                    />
                                </Field>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

interface SchemaOwnershipPickerProps {
    schemas: string[];
    selectedSchemas: string[];
    onChange: (next: string[]) => void;
}

const SchemaOwnershipPicker = ({
    schemas,
    selectedSchemas,
    onChange,
}: SchemaOwnershipPickerProps) => {
    const styles = useStyles();
    const [pendingSchema, setPendingSchema] = useState<string | undefined>(undefined);

    const availableSchemas = schemas.filter((schema) => !selectedSchemas.includes(schema));
    const options = availableSchemas.map((schema) => ({ value: schema, text: schema }));

    const addSchema = () => {
        if (!pendingSchema) {
            return;
        }
        onChange([...selectedSchemas, pendingSchema]);
        setPendingSchema(undefined);
    };

    return (
        <div className={styles.sectionBlock}>
            {selectedSchemas.length > 0 ? (
                <div className={styles.chipRow}>
                    {selectedSchemas.map((schema) => (
                        <span key={schema} className={styles.chip}>
                            {schema}
                            <Button
                                appearance="subtle"
                                icon={<Dismiss16Regular />}
                                aria-label={locConstants.common.delete}
                                className={styles.chipRemove}
                                onClick={() =>
                                    onChange(
                                        selectedSchemas.filter((item) => item !== schema),
                                    )
                                }
                            />
                        </span>
                    ))}
                </div>
            ) : (
                <Text className={styles.helperText}>
                    {locConstants.userDialog.noOwnedSchemas}
                </Text>
            )}
            <div className={styles.addSchemaRow}>
                <div className={styles.addSchemaSelect}>
                    <SearchableDropdown
                        options={options}
                        selectedOption={
                            pendingSchema
                                ? { value: pendingSchema, text: pendingSchema }
                                : undefined
                        }
                        onSelect={(option) => setPendingSchema(option.value)}
                        ariaLabel={locConstants.userDialog.schemaOwnershipSelectLabel}
                        placeholder={locConstants.userDialog.schemaOwnershipSelectPlaceholder}
                        size="medium"
                    />
                </div>
                <Button
                    appearance="secondary"
                    icon={<AddRegular />}
                    disabled={!pendingSchema}
                    onClick={addSchema}>
                    {locConstants.userDialog.addSchemaButton}
                </Button>
            </div>
        </div>
    );
};

interface RoleMembershipGridProps {
    roles: string[];
    selectedRoles: string[];
    onToggle: (value: string, checked: boolean) => void;
    searchPlaceholder: string;
}

const RoleMembershipGrid = ({
    roles,
    selectedRoles,
    onToggle,
    searchPlaceholder,
}: RoleMembershipGridProps) => {
    const styles = useStyles();
    const [query, setQuery] = useState("");
    const tokens = useMemo(() => buildSearchTokens(query), [query]);

    const filteredRoles = useMemo(
        () => roles.filter((role) => matchesSearch(role, tokens)),
        [roles, tokens],
    );

    const columnCount = 4;
    const rowCount = Math.ceil(filteredRoles.length / columnCount);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const virtualizer = useVirtualizer({
        count: rowCount,
        getScrollElement: () => containerRef.current,
        estimateSize: () => LIST_ROW_HEIGHT,
        overscan: 6,
    });

    if (roles.length === 0) {
        return <Text className={styles.helperText}>{locConstants.userDialog.membershipEmpty}</Text>;
    }

    return (
        <div className={styles.sectionBlock}>
            <SearchBox
                className={styles.roleSearch}
                placeholder={searchPlaceholder}
                value={query}
                onChange={(_, data) => setQuery(data.value)}
            />
            {filteredRoles.length === 0 ? (
                <Text className={styles.helperText}>{locConstants.common.noResults}</Text>
            ) : (
                <div ref={containerRef} className={styles.roleList}>
                    <div
                        className={styles.roleInner}
                        style={{ height: `${virtualizer.getTotalSize()}px` }}>
                        {virtualizer.getVirtualItems().map((virtualItem) => {
                            const rowIndex = virtualItem.index;
                            const start = rowIndex * columnCount;
                            const rowRoles = filteredRoles.slice(
                                start,
                                start + columnCount,
                            );
                            const isLast = rowIndex === rowCount - 1;
                            return (
                                <div
                                    key={virtualItem.key}
                                    className={`${styles.roleRow} ${
                                        isLast ? styles.roleRowLast : ""
                                    }`}
                                    style={{
                                        height: `${virtualItem.size}px`,
                                        transform: `translateY(${virtualItem.start}px)`,
                                    }}>
                                    {rowRoles.map((role) => (
                                        <div key={role} className={styles.roleCell}>
                                            <Checkbox
                                                checked={selectedRoles.includes(role)}
                                                onChange={(_, data) =>
                                                    onToggle(role, !!data.checked)
                                                }
                                            />
                                            <Text>
                                                {renderHighlightedText(
                                                    role,
                                                    tokens,
                                                    styles.highlight,
                                                )}
                                            </Text>
                                        </div>
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

interface SecurablesSectionProps {
    securables: SecurablePermissions[];
    schemas: string[];
    supportedSecurableTypes: SecurableTypeMetadata[];
    onChange: (next: SecurablePermissions[]) => void;
    onSearchSecurables: (params: ObjectManagementSearchParams) => Promise<ObjectManagementSearchResult>;
}

const SecurablesSection = ({
    securables,
    schemas,
    supportedSecurableTypes,
    onChange,
    onSearchSecurables,
}: SecurablesSectionProps) => {
    const styles = useStyles();
    const [selectedKey, setSelectedKey] = useState<string | undefined>(undefined);
    const [securableSearch, setSecurableSearch] = useState("");
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const [searchMethod, setSearchMethod] = useState<SearchMethod>("specific");
    const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
    const [selectedSchema, setSelectedSchema] = useState<string | undefined>(undefined);
    const [searchText, setSearchText] = useState("");
    const [searchResults, setSearchResults] = useState<ObjectManagementSearchResultItem[]>(
        [],
    );
    const [searchSelection, setSearchSelection] = useState<Set<string>>(new Set());
    const [searchError, setSearchError] = useState<string | undefined>(undefined);
    const [searchLoading, setSearchLoading] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);
    const searchRequestId = useRef(0);
    const hasInitializedTypes = useRef(false);

    const securableSearchTokens = useMemo(
        () => buildSearchTokens(securableSearch),
        [securableSearch],
    );
    const drawerSearchTokens = useMemo(
        () => (searchMethod === "specific" ? buildSearchTokens(searchText) : []),
        [searchMethod, searchText],
    );

    const filteredSecurables = useMemo(() => {
        if (securableSearchTokens.length === 0) {
            return securables;
        }
        return securables.filter((item) => {
            const typeLabel = getTypeLabel(item.type ?? "", supportedSecurableTypes);
            const label = `${item.name ?? ""} ${item.schema ?? ""} ${typeLabel}`;
            return matchesSearch(label, securableSearchTokens);
        });
    }, [securables, securableSearchTokens, supportedSecurableTypes]);

    const tableScrollRef = useRef<HTMLDivElement | null>(null);
    const securableVirtualizer = useVirtualizer({
        count: filteredSecurables.length,
        getScrollElement: () => tableScrollRef.current,
        estimateSize: () => TABLE_ROW_HEIGHT,
        overscan: 8,
    });

    const securableVirtualItems = securableVirtualizer.getVirtualItems();
    const securablePaddingTop =
        securableVirtualItems.length > 0 ? securableVirtualItems[0].start : 0;
    const securablePaddingBottom =
        securableVirtualItems.length > 0
            ? securableVirtualizer.getTotalSize() -
              securableVirtualItems[securableVirtualItems.length - 1].end
            : 0;

    useEffect(() => {
        if (!hasInitializedTypes.current && supportedSecurableTypes.length) {
            setSelectedTypes(supportedSecurableTypes.map((item) => item.name));
            hasInitializedTypes.current = true;
        }
    }, [supportedSecurableTypes]);

    useEffect(() => {
        if (!securables.length) {
            setSelectedKey(undefined);
            return;
        }
        if (
            !selectedKey ||
            !securables.some((item) => buildSecurableKey(item) === selectedKey)
        ) {
            setSelectedKey(buildSecurableKey(securables[0]));
        }
    }, [securables, selectedKey]);

    useEffect(() => {
        if (isDrawerOpen) {
            setSearchResults([]);
            setSearchSelection(new Set());
            setSearchError(undefined);
            setSearchText("");
            setHasSearched(false);
        }
    }, [isDrawerOpen]);

    const selectedSecurable = useMemo(
        () => securables.find((item) => buildSecurableKey(item) === selectedKey),
        [securables, selectedKey],
    );

    const selectedIndex = selectedSecurable
        ? securables.findIndex((item) => buildSecurableKey(item) === selectedKey)
        : -1;

    const addSecurables = useCallback(
        (items: ObjectManagementSearchResultItem[]) => {
            if (!items.length) {
                return;
            }
            const updated = [...securables];
            items.forEach((item) => {
                const key = buildSecurableKey(item);
                if (updated.some((existing) => buildSecurableKey(existing) === key)) {
                    return;
                }
                const permissions = buildDefaultPermissions(item.type, supportedSecurableTypes);
                updated.push({
                    name: item.name ?? "",
                    schema: item.schema,
                    type: item.type ?? "",
                    permissions,
                    effectivePermissions: [],
                });
            });
            onChange(updated);
        },
        [onChange, securables, supportedSecurableTypes],
    );

    const removeSelected = () => {
        if (!selectedKey) {
            return;
        }
        const updated = securables.filter(
            (item) => buildSecurableKey(item) !== selectedKey,
        );
        onChange(updated);
        setSelectedKey(undefined);
    };

    const updatePermission = (
        permissionName: string,
        column: "grant" | "withGrant" | "deny",
        checked: boolean,
    ) => {
        if (!selectedSecurable || selectedIndex === -1) {
            return;
        }
        const permissions = [...(selectedSecurable.permissions ?? [])];
        let permissionItem = permissions.find(
            (permission) => permission.permission === permissionName,
        );
        if (!permissionItem) {
            permissionItem = { permission: permissionName, grantor: "" };
            permissions.push(permissionItem);
        }

        if (column === "grant") {
            permissionItem.grant = checked ? true : undefined;
            if (!checked) {
                permissionItem.withGrant = undefined;
            }
        } else if (column === "withGrant") {
            permissionItem.withGrant = checked ? true : undefined;
            if (checked) {
                permissionItem.grant = true;
            }
        } else if (column === "deny") {
            permissionItem.grant = checked ? false : undefined;
            if (checked) {
                permissionItem.withGrant = undefined;
            }
        }

        const updated = securables.map((item, index) =>
            index === selectedIndex ? { ...item, permissions } : item,
        );
        onChange(updated);
    };

    useEffect(() => {
        if (searchMethod === "schema" && !selectedSchema && schemas.length > 0) {
            setSelectedSchema(schemas[0]);
        }
    }, [schemas, searchMethod, selectedSchema]);

    useEffect(() => {
        if (!isDrawerOpen) {
            return;
        }
        if (selectedTypes.length === 0) {
            setSearchError(locConstants.userDialog.searchTypeRequired);
            setSearchResults([]);
            setSearchLoading(false);
            setHasSearched(false);
            return;
        }
        if (searchMethod === "specific" && !searchText.trim()) {
            setSearchResults([]);
            setSearchError(undefined);
            setSearchSelection(new Set());
            setSearchLoading(false);
            setHasSearched(false);
            return;
        }
        if (searchMethod === "schema" && !selectedSchema) {
            setSearchResults([]);
            setSearchError(locConstants.userDialog.searchSchemaRequired);
            setSearchLoading(false);
            setHasSearched(false);
            return;
        }

        const params: ObjectManagementSearchParams = {
            objectTypes: selectedTypes,
            searchText: searchMethod === "specific" ? searchText.trim() : undefined,
            schema:
                searchMethod === "schema" || searchMethod === "specific"
                    ? selectedSchema || undefined
                    : undefined,
        };

        setSearchLoading(true);
        setSearchError(undefined);
        setHasSearched(true);

        const currentRequest = ++searchRequestId.current;
        const timeout = setTimeout(async () => {
            const result = await onSearchSecurables(params);
            if (currentRequest !== searchRequestId.current) {
                return;
            }
            if (!result.success) {
                setSearchResults([]);
                setSearchError(result.errorMessage || locConstants.userDialog.searchFailed);
            } else {
                setSearchResults(result.results ?? []);
                setSearchSelection(new Set());
            }
            setSearchLoading(false);
        }, 300);

        return () => clearTimeout(timeout);
    }, [
        isDrawerOpen,
        onSearchSecurables,
        searchMethod,
        searchText,
        selectedSchema,
        selectedTypes,
    ]);

    const permissionRows = useMemo(() => {
        if (!selectedSecurable) {
            return [];
        }
        const typeMetadata = supportedSecurableTypes.find(
            (item) => item.name === selectedSecurable.type,
        );
        const permissionsMetadata = typeMetadata?.permissions ?? [];
        return permissionsMetadata.map((permissionMetadata) => {
            const permissionName = permissionMetadata.name ?? "";
            const permission = selectedSecurable.permissions?.find(
                (item) => item.permission === permissionName,
            );
            return {
                name: permissionName,
                displayName: permissionMetadata.displayName ?? permissionName,
                grantor: permission?.grantor ?? "",
                grant: permission?.grant === true,
                withGrant: permission?.withGrant === true,
                deny: permission?.grant === false,
            };
        });
    }, [selectedSecurable, supportedSecurableTypes]);

    const schemaOptions = schemas.map((schema) => ({ value: schema, text: schema }));
    const searchCards = [
        {
            value: "specific" as SearchMethod,
            title: locConstants.userDialog.searchMethodSpecific,
            description: locConstants.userDialog.searchMethodSpecificDescription,
            icon: "S",
        },
        {
            value: "types" as SearchMethod,
            title: locConstants.userDialog.searchMethodTypes,
            description: locConstants.userDialog.searchMethodTypesDescription,
            icon: "T",
        },
        {
            value: "schema" as SearchMethod,
            title: locConstants.userDialog.searchMethodSchema,
            description: locConstants.userDialog.searchMethodSchemaDescription,
            icon: "DB",
        },
    ];

    const handleAddFromDrawer = () => {
        if (searchMethod === "specific") {
            const selectionKeys = new Set(searchSelection);
            const items = searchResults.filter((item) =>
                selectionKeys.has(buildSecurableKey(item)),
            );
            addSecurables(items);
        } else {
            addSecurables(searchResults);
        }
        setIsDrawerOpen(false);
    };

    const canAdd =
        searchMethod === "specific" ? searchSelection.size > 0 : searchResults.length > 0;
    const selectionCount =
        searchMethod === "specific" ? searchSelection.size : searchResults.length;
    const typeSelectionError = selectedTypes.length === 0 ? searchError : undefined;

    return (
        <div className={styles.section}>
            <div className={styles.tableToolbar}>
                <div className={styles.tableSearch}>
                    <SearchBox
                        className={styles.searchBox}
                        placeholder={locConstants.userDialog.searchSecurablesPlaceholder}
                        value={securableSearch}
                        onChange={(_, data) => setSecurableSearch(data.value)}
                    />
                </div>
            </div>

            <div className={styles.tableScroll} ref={tableScrollRef}>
                <Table role="grid" className={styles.table}>
                    <TableHeader>
                        <TableRow>
                            <TableHeaderCell className={styles.tableHeaderCell}>
                                {locConstants.userDialog.securableNameColumn}
                            </TableHeaderCell>
                            <TableHeaderCell className={styles.tableHeaderCell}>
                                {locConstants.userDialog.securableSchemaColumn}
                            </TableHeaderCell>
                            <TableHeaderCell className={styles.tableHeaderCell}>
                                {locConstants.userDialog.securableTypeColumn}
                            </TableHeaderCell>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredSecurables.length === 0 ? (
                            <TableRow>
                                <TableCell
                                    colSpan={3}
                                    className={`${styles.tableCell} ${styles.tableCellMuted}`}>
                                    {securables.length === 0
                                        ? locConstants.userDialog.securablesEmpty
                                        : locConstants.common.noResults}
                                </TableCell>
                            </TableRow>
                        ) : (
                            <>
                                {securablePaddingTop > 0 && (
                                    <TableRow>
                                        <TableCell
                                            colSpan={3}
                                            className={styles.tableSpacerCell}
                                            style={{
                                                height: `${securablePaddingTop}px`,
                                            }}
                                        />
                                    </TableRow>
                                )}
                                {securableVirtualItems.map((virtualItem) => {
                                    const securable =
                                        filteredSecurables[virtualItem.index];
                                    const key = buildSecurableKey(securable);
                                    const isSelected = key === selectedKey;
                                    return (
                                        <TableRow
                                            key={virtualItem.key}
                                            className={`${styles.tableRow} ${
                                                isSelected ? styles.tableRowSelected : ""
                                            }`}
                                            onClick={() => setSelectedKey(key)}>
                                            <TableCell className={styles.tableCell}>
                                                {renderHighlightedText(
                                                    securable.name ?? "",
                                                    securableSearchTokens,
                                                    styles.highlight,
                                                )}
                                            </TableCell>
                                            <TableCell className={styles.tableCell}>
                                                {renderHighlightedText(
                                                    securable.schema ??
                                                        locConstants.userDialog.valueUnknown,
                                                    securableSearchTokens,
                                                    styles.highlight,
                                                )}
                                            </TableCell>
                                            <TableCell className={styles.tableCell}>
                                                {renderHighlightedText(
                                                    getTypeLabel(
                                                        securable.type ?? "",
                                                        supportedSecurableTypes,
                                                    ),
                                                    securableSearchTokens,
                                                    styles.highlight,
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                                {securablePaddingBottom > 0 && (
                                    <TableRow>
                                        <TableCell
                                            colSpan={3}
                                            className={styles.tableSpacerCell}
                                            style={{
                                                height: `${securablePaddingBottom}px`,
                                            }}
                                        />
                                    </TableRow>
                                )}
                            </>
                        )}
                    </TableBody>
                </Table>
            </div>

            <div className={styles.tableActions}>
                <Button appearance="secondary" onClick={() => setIsDrawerOpen(true)}>
                    {locConstants.userDialog.addSecurableButton}
                </Button>
                <Button appearance="secondary" disabled={!selectedKey} onClick={removeSelected}>
                    {locConstants.userDialog.removeSecurableButton}
                </Button>
            </div>

            <div className={styles.permissionsGroup}>
                <div className={styles.sectionTitle}>
                    {locConstants.userDialog.permissionsSection}
                </div>
                <Table role="grid" className={styles.table}>
                    <TableHeader>
                        <TableRow>
                            <TableHeaderCell className={styles.tableHeaderCell}>
                                {locConstants.userDialog.permissionColumn}
                            </TableHeaderCell>
                            <TableHeaderCell className={styles.tableHeaderCell}>
                                {locConstants.userDialog.grantorColumn}
                            </TableHeaderCell>
                            <TableHeaderCell className={styles.tableHeaderCell}>
                                {locConstants.userDialog.grantColumn}
                            </TableHeaderCell>
                            <TableHeaderCell className={styles.tableHeaderCell}>
                                {locConstants.userDialog.withGrantColumn}
                            </TableHeaderCell>
                            <TableHeaderCell className={styles.tableHeaderCell}>
                                {locConstants.userDialog.denyColumn}
                            </TableHeaderCell>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {permissionRows.length === 0 ? (
                            <TableRow>
                                <TableCell
                                    colSpan={5}
                                    className={`${styles.tableCell} ${styles.tableCellMuted}`}>
                                    {locConstants.userDialog.explicitPermissionsEmpty}
                                </TableCell>
                            </TableRow>
                        ) : (
                            permissionRows.map((permission) => (
                                <TableRow key={permission.name}>
                                    <TableCell className={styles.tableCell}>
                                        {permission.displayName}
                                    </TableCell>
                                    <TableCell className={styles.tableCell}>
                                        {permission.grantor ||
                                            locConstants.userDialog.valueUnknown}
                                    </TableCell>
                                    <TableCell className={styles.tableCell}>
                                        <Checkbox
                                            checked={permission.grant}
                                            onChange={(_, data) =>
                                                updatePermission(
                                                    permission.name,
                                                    "grant",
                                                    !!data.checked,
                                                )
                                            }
                                        />
                                    </TableCell>
                                    <TableCell className={styles.tableCell}>
                                        <Checkbox
                                            checked={permission.withGrant}
                                            onChange={(_, data) =>
                                                updatePermission(
                                                    permission.name,
                                                    "withGrant",
                                                    !!data.checked,
                                                )
                                            }
                                        />
                                    </TableCell>
                                    <TableCell className={styles.tableCell}>
                                        <Checkbox
                                            checked={permission.deny}
                                            onChange={(_, data) =>
                                                updatePermission(
                                                    permission.name,
                                                    "deny",
                                                    !!data.checked,
                                                )
                                            }
                                        />
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>

                <div className={styles.sectionTitle}>
                    {locConstants.userDialog.effectivePermissionsSection}
                </div>
                <Table role="grid" className={styles.table}>
                    <TableHeader>
                        <TableRow>
                            <TableHeaderCell className={styles.tableHeaderCell}>
                                {locConstants.userDialog.permissionColumn}
                            </TableHeaderCell>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {selectedSecurable?.effectivePermissions?.length ? (
                            selectedSecurable.effectivePermissions.map((permission) => (
                                <TableRow key={permission}>
                                    <TableCell className={styles.tableCell}>
                                        {permission}
                                    </TableCell>
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell
                                    colSpan={1}
                                    className={`${styles.tableCell} ${styles.tableCellMuted}`}>
                                    {locConstants.userDialog.effectivePermissionsEmpty}
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            <Drawer
                separator
                open={isDrawerOpen}
                onOpenChange={(_, data) => setIsDrawerOpen(data.open)}
                position="end"
                size="medium">
                <DrawerHeader>
                    <DrawerHeaderTitle
                        action={
                            <Button
                                appearance="subtle"
                                aria-label={locConstants.common.close}
                                icon={<Dismiss24Regular />}
                                onClick={() => setIsDrawerOpen(false)}
                            />
                        }>
                        {locConstants.userDialog.addSecurableTitle}
                    </DrawerHeaderTitle>
                </DrawerHeader>
                <DrawerBody className={styles.drawerBody}>
                    <div className={styles.drawerSection}>
                        <Text>{locConstants.userDialog.searchMethodLabel}</Text>
                        <div className={styles.selectionCards}>
                            {searchCards.map((card) => {
                                const isActive = searchMethod === card.value;
                                return (
                                    <button
                                        key={card.value}
                                        type="button"
                                        className={`${styles.selectionCard} ${
                                            isActive ? styles.selectionCardActive : ""
                                        }`}
                                        aria-pressed={isActive}
                                        onClick={() => setSearchMethod(card.value)}>
                                        <div className={styles.selectionRadio}>
                                            {isActive && (
                                                <div
                                                    className={
                                                        styles.selectionRadioInner
                                                    }
                                                />
                                            )}
                                        </div>
                                        <div
                                            className={`${styles.selectionIconBox} ${
                                                isActive
                                                    ? styles.selectionIconActive
                                                    : ""
                                            }`}>
                                            <Text>{card.icon}</Text>
                                        </div>
                                        <div>
                                            <Text className={styles.selectionTitle}>
                                                {card.title}
                                            </Text>
                                            <Text className={styles.selectionDescription}>
                                                {card.description}
                                            </Text>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className={styles.drawerSection}>
                        <Text>
                            {searchMethod === "specific"
                                ? locConstants.userDialog.quickFiltersLabel
                                : locConstants.userDialog.searchTypesLabel}
                        </Text>
                        <div className={styles.filterChips}>
                            {supportedSecurableTypes.map((item) => {
                                const isActive = selectedTypes.includes(item.name);
                                return (
                                    <Button
                                        key={item.name}
                                        appearance="secondary"
                                        size="small"
                                        className={`${styles.filterChip} ${
                                            isActive ? styles.filterChipActive : ""
                                        }`}
                                        onClick={() => {
                                            const next = new Set(selectedTypes);
                                            if (isActive) {
                                                next.delete(item.name);
                                            } else {
                                                next.add(item.name);
                                            }
                                            setSelectedTypes(Array.from(next));
                                        }}>
                                        {item.displayName ?? item.name}
                                    </Button>
                                );
                            })}
                        </div>
                        {typeSelectionError && (
                            <Text className={styles.helperText}>{typeSelectionError}</Text>
                        )}
                    </div>

                    {(searchMethod === "schema" || searchMethod === "specific") &&
                        schemaOptions.length > 0 && (
                        <div className={styles.drawerSection}>
                            <Text>{locConstants.userDialog.searchSchemaLabel}</Text>
                            <SearchableDropdown
                                options={schemaOptions}
                                selectedOption={
                                    selectedSchema
                                        ? {
                                              value: selectedSchema,
                                              text: selectedSchema,
                                          }
                                        : undefined
                                }
                                onSelect={(option) => setSelectedSchema(option.value)}
                                placeholder={locConstants.userDialog.searchSchemaPlaceholder}
                                ariaLabel={locConstants.userDialog.searchSchemaLabel}
                                size="medium"
                                clearable
                            />
                        </div>
                    )}

                    {searchMethod === "specific" && (
                        <div className={styles.drawerSection}>
                            <SearchBox
                                className={styles.searchBox}
                                placeholder={locConstants.userDialog.searchTextLabel}
                                value={searchText}
                                onChange={(_, data) => setSearchText(data.value)}
                            />
                        </div>
                    )}

                    <div className={styles.infoCallout}>
                        <div className={styles.infoCalloutIcon}>i</div>
                        <Text>{locConstants.userDialog.securablesInfoCallout}</Text>
                    </div>

                    <div className={styles.addDialogResults}>
                        {searchLoading && !searchError && (
                            <Text className={styles.helperText}>
                                {locConstants.userDialog.searchLoading}
                            </Text>
                        )}
                        {searchError ? (
                            <Text className={styles.helperText}>{searchError}</Text>
                        ) : searchResults.length === 0 ? (
                            <Text className={styles.helperText}>
                                {hasSearched
                                    ? locConstants.userDialog.searchNoResults
                                    : locConstants.userDialog.searchStart}
                            </Text>
                        ) : (
                            <Table role="grid" className={styles.table}>
                                <TableHeader>
                                    <TableRow>
                                        <TableHeaderCell className={styles.tableHeaderCell}>
                                            {locConstants.userDialog.securableNameColumn}
                                        </TableHeaderCell>
                                        <TableHeaderCell className={styles.tableHeaderCell}>
                                            {locConstants.userDialog.securableSchemaColumn}
                                        </TableHeaderCell>
                                        <TableHeaderCell className={styles.tableHeaderCell}>
                                            {locConstants.userDialog.securableTypeColumn}
                                        </TableHeaderCell>
                                        {searchMethod === "specific" && (
                                            <TableHeaderCell
                                                className={styles.tableHeaderCell}>
                                                {locConstants.userDialog.selectColumn}
                                            </TableHeaderCell>
                                        )}
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {searchResults.map((result) => {
                                        const key = buildSecurableKey(result);
                                        const isSelected = searchSelection.has(key);
                                        return (
                                            <TableRow key={key}>
                                                <TableCell className={styles.tableCell}>
                                                    {renderHighlightedText(
                                                        result.name ?? "",
                                                        drawerSearchTokens,
                                                        styles.highlight,
                                                    )}
                                                </TableCell>
                                                <TableCell className={styles.tableCell}>
                                                    {result.schema ??
                                                        locConstants.userDialog.valueUnknown}
                                                </TableCell>
                                                <TableCell className={styles.tableCell}>
                                                    {getTypeLabel(
                                                        result.type ?? "",
                                                        supportedSecurableTypes,
                                                    )}
                                                </TableCell>
                                                {searchMethod === "specific" && (
                                                    <TableCell className={styles.tableCell}>
                                                        <Checkbox
                                                            checked={isSelected}
                                                            onChange={(_, data) => {
                                                                const next = new Set(
                                                                    searchSelection,
                                                                );
                                                                if (data.checked) {
                                                                    next.add(key);
                                                                } else {
                                                                    next.delete(key);
                                                                }
                                                                setSearchSelection(next);
                                                            }}
                                                        />
                                                    </TableCell>
                                                )}
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        )}
                    </div>
                </DrawerBody>
                <DrawerFooter>
                    <div className={styles.addDialogFooter}>
                        <Text className={styles.badge}>
                            {searchMethod === "specific"
                                ? locConstants.userDialog.selectedCount(selectionCount)
                                : locConstants.userDialog.resultsCount(selectionCount)}
                        </Text>
                        <div className={styles.tableButtons}>
                            <Button
                                appearance="secondary"
                                onClick={() => setIsDrawerOpen(false)}>
                                {locConstants.userDialog.cancelButton}
                            </Button>
                            <Button
                                appearance="primary"
                                disabled={!canAdd}
                                onClick={handleAddFromDrawer}>
                                {locConstants.userDialog.addSelectedButton}
                            </Button>
                        </div>
                    </div>
                </DrawerFooter>
            </Drawer>
        </div>
    );
};

const buildDefaultPermissions = (
    type: string | undefined,
    supportedTypes: SecurableTypeMetadata[],
): SecurablePermissionItem[] => {
    if (!type) {
        return [];
    }
    const typeMetadata = supportedTypes.find((item) => item.name === type);
    return (
        typeMetadata?.permissions?.map((permission) => ({
            permission: permission.name ?? "",
            grantor: "",
            grant: undefined,
            withGrant: undefined,
        })) ?? []
    );
};
