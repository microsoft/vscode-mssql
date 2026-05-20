/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Field,
    Input,
    makeStyles,
    mergeClasses,
    Radio,
    RadioGroup,
    Text,
    ToggleButton,
    tokens,
} from "@fluentui/react-components";
import { useEffect, useState } from "react";
import { locConstants } from "../../../common/locConstants";
import { Dab } from "../../../../sharedInterfaces/dab";

const useStyles = makeStyles({
    surface: {
        width: "500px",
        maxWidth: "500px",
    },
    content: {
        display: "flex",
        flexDirection: "column",
        gap: "16px",
    },
    fieldHint: {
        fontSize: "12px",
        color: tokens.colorNeutralForeground3,
        marginTop: "2px",
    },
    roleButtonsContainer: {
        display: "flex",
        gap: "8px",
    },
    roleButton: {
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "12px",
        minHeight: "60px",
        whiteSpace: "normal",
    },
    roleButtonLabel: {
        fontWeight: 600,
        lineHeight: "18px",
    },
    roleButtonLabelSelected: {
        color: tokens.colorNeutralForegroundOnBrand,
    },
    roleButtonLabelUnselected: {
        color: tokens.colorNeutralForeground1,
    },
    roleButtonContent: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "4px",
        textAlign: "center",
    },
    roleButtonDescription: {
        fontSize: "11px",
        lineHeight: "14px",
    },
    roleButtonDescriptionSelected: {
        color: tokens.colorNeutralForegroundOnBrand,
    },
    roleButtonDescriptionUnselected: {
        color: tokens.colorNeutralForeground2,
    },
    sourceTableText: {
        fontSize: "12px",
        color: tokens.colorNeutralForeground3,
        marginBottom: "8px",
    },
    actions: {
        columnGap: "12px",
    },
    actionButton: {
        minWidth: "132px",
        whiteSpace: "nowrap",
    },
    checkboxGroup: {
        display: "flex",
        flexDirection: "column",
        rowGap: "4px",
    },
    methodGroup: {
        display: "flex",
        flexWrap: "wrap",
        columnGap: "8px",
        rowGap: "4px",
    },
});

interface DabEntitySettingsDialogProps {
    entity: Dab.DabEntityConfig;
    isRestEnabled: boolean;
    isGraphQLEnabled: boolean;
    isMcpEnabled: boolean;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onApply: (settings: Dab.EntityAdvancedSettings) => void;
}

export function DabEntitySettingsDialog({
    entity,
    isRestEnabled,
    isGraphQLEnabled,
    isMcpEnabled,
    open,
    onOpenChange,
    onApply,
}: DabEntitySettingsDialogProps) {
    const classes = useStyles();

    // Local state for form - initialized when dialog opens
    const [localSettings, setLocalSettings] = useState<Dab.EntityAdvancedSettings>(
        entity.advancedSettings,
    );

    // Reset local state when dialog opens
    useEffect(() => {
        if (open) {
            setLocalSettings(entity.advancedSettings);
        }
    }, [open, entity.advancedSettings]);

    const handleApply = () => {
        onApply(localSettings);
    };

    const handleCancel = () => {
        onOpenChange(false);
    };

    const updateEntityName = (value: string) => {
        setLocalSettings((prev) => ({ ...prev, entityName: value }));
    };

    const updateAuthorizationRole = (role: Dab.AuthorizationRole) => {
        setLocalSettings((prev) => ({ ...prev, authorizationRole: role }));
    };

    const updateCustomRestPath = (value: string) => {
        setLocalSettings((prev) => ({ ...prev, customRestPath: value || undefined }));
    };

    const updateRestEnabled = (value: boolean) => {
        setLocalSettings((prev) => ({ ...prev, restEnabled: value }));
    };

    const updateCustomGraphQLType = (value: string) => {
        setLocalSettings((prev) => ({ ...prev, customGraphQLType: value || undefined }));
    };

    const updateGraphQLEnabled = (value: boolean) => {
        setLocalSettings((prev) => ({ ...prev, graphQLEnabled: value }));
    };

    const updateStoredProcedureRestMethod = (method: Dab.RestMethod, isEnabled: boolean) => {
        setLocalSettings((prev) => {
            const methods = prev.storedProcedureRestMethods ?? [Dab.RestMethod.Post];
            const nextMethods = isEnabled
                ? [...methods, method]
                : methods.filter((existingMethod) => existingMethod !== method);
            return {
                ...prev,
                storedProcedureRestMethods: nextMethods.length
                    ? Array.from(new Set(nextMethods))
                    : [Dab.RestMethod.Post],
            };
        });
    };

    const updateStoredProcedureGraphQLOperation = (operation: Dab.GraphQLOperation) => {
        setLocalSettings((prev) => ({ ...prev, storedProcedureGraphQLOperation: operation }));
    };

    const updateExposeAsMcpCustomTool = (value: boolean) => {
        setLocalSettings((prev) => ({ ...prev, exposeAsMcpCustomTool: value }));
    };

    const isStoredProcedure = entity.sourceType === Dab.EntitySourceType.StoredProcedure;
    const isAnonymousSelected = localSettings.authorizationRole === Dab.AuthorizationRole.Anonymous;
    const isAuthenticatedSelected =
        localSettings.authorizationRole === Dab.AuthorizationRole.Authenticated;
    const isEntityRestEnabled = localSettings.restEnabled !== false;
    const isEntityGraphQLEnabled = localSettings.graphQLEnabled !== false;
    const isRestSectionEnabled = isRestEnabled && isEntityRestEnabled;
    const isGraphQLSectionEnabled = isGraphQLEnabled && isEntityGraphQLEnabled;
    const storedProcedureRestMethods = localSettings.storedProcedureRestMethods ?? [
        Dab.RestMethod.Post,
    ];
    const storedProcedureGraphQLOperation =
        localSettings.storedProcedureGraphQLOperation ?? Dab.GraphQLOperation.Mutation;
    const exposeAsMcpCustomTool = localSettings.exposeAsMcpCustomTool !== false;
    const mcpCustomToolHelpText = isMcpEnabled
        ? locConstants.schemaDesigner.exposeAsMcpCustomToolHelp
        : locConstants.schemaDesigner.enableMcpForCustomToolHelp;

    return (
        <Dialog open={open} onOpenChange={(_, data) => onOpenChange(data.open)}>
            <DialogSurface className={classes.surface}>
                <DialogBody>
                    <DialogTitle>
                        {locConstants.schemaDesigner.advancedEntityConfiguration}
                    </DialogTitle>
                    <DialogContent className={classes.content}>
                        {/* Source Table Info */}
                        <Text className={classes.sourceTableText}>
                            {locConstants.schemaDesigner.sourceTableWithName(
                                `${entity.schemaName}.${entity.sourceName ?? entity.tableName}`,
                            )}
                        </Text>

                        {/* Entity Name Field */}
                        <Field label={locConstants.schemaDesigner.entityName}>
                            <Input
                                value={localSettings.entityName}
                                onChange={(_, data) => updateEntityName(data.value)}
                            />
                            <Text className={classes.fieldHint}>
                                {locConstants.schemaDesigner.entityNameHelp}
                            </Text>
                        </Field>

                        {/* Authorization Role */}
                        <Field label={locConstants.schemaDesigner.authorizationRole}>
                            <Text className={classes.fieldHint} style={{ marginBottom: "8px" }}>
                                {locConstants.schemaDesigner.authorizationRoleHelp}
                            </Text>
                            <div className={classes.roleButtonsContainer}>
                                <ToggleButton
                                    className={classes.roleButton}
                                    appearance={isAnonymousSelected ? "primary" : "outline"}
                                    checked={isAnonymousSelected}
                                    onClick={() =>
                                        updateAuthorizationRole(Dab.AuthorizationRole.Anonymous)
                                    }>
                                    <div className={classes.roleButtonContent}>
                                        <span
                                            className={mergeClasses(
                                                classes.roleButtonLabel,
                                                isAnonymousSelected
                                                    ? classes.roleButtonLabelSelected
                                                    : classes.roleButtonLabelUnselected,
                                            )}>
                                            {locConstants.schemaDesigner.anonymous}
                                        </span>
                                        <span
                                            className={mergeClasses(
                                                classes.roleButtonDescription,
                                                isAnonymousSelected
                                                    ? classes.roleButtonDescriptionSelected
                                                    : classes.roleButtonDescriptionUnselected,
                                            )}>
                                            {locConstants.schemaDesigner.anonymousDescription}
                                        </span>
                                    </div>
                                </ToggleButton>
                                <ToggleButton
                                    className={classes.roleButton}
                                    appearance={isAuthenticatedSelected ? "primary" : "outline"}
                                    checked={isAuthenticatedSelected}
                                    onClick={() =>
                                        updateAuthorizationRole(Dab.AuthorizationRole.Authenticated)
                                    }>
                                    <div className={classes.roleButtonContent}>
                                        <span
                                            className={mergeClasses(
                                                classes.roleButtonLabel,
                                                isAuthenticatedSelected
                                                    ? classes.roleButtonLabelSelected
                                                    : classes.roleButtonLabelUnselected,
                                            )}>
                                            {locConstants.schemaDesigner.authenticated}
                                        </span>
                                        <span
                                            className={mergeClasses(
                                                classes.roleButtonDescription,
                                                isAuthenticatedSelected
                                                    ? classes.roleButtonDescriptionSelected
                                                    : classes.roleButtonDescriptionUnselected,
                                            )}>
                                            {locConstants.schemaDesigner.authenticatedDescription}
                                        </span>
                                    </div>
                                </ToggleButton>
                            </div>
                        </Field>

                        {/* Custom REST Path */}
                        <Field label={locConstants.schemaDesigner.customRestPath}>
                            <div className={classes.checkboxGroup}>
                                <Checkbox
                                    checked={isEntityRestEnabled}
                                    disabled={!isRestEnabled}
                                    onChange={(_, data) => updateRestEnabled(!!data.checked)}
                                    label={locConstants.schemaDesigner.enableRestForEntity}
                                />
                                {!isRestEnabled && (
                                    <Text className={classes.fieldHint}>
                                        {locConstants.schemaDesigner.enableRestForEntityHelp}
                                    </Text>
                                )}
                            </div>
                            <Input
                                value={localSettings.customRestPath ?? ""}
                                placeholder={(entity.sourceName ?? entity.tableName).toLowerCase()}
                                disabled={!isRestSectionEnabled}
                                onChange={(_, data) => updateCustomRestPath(data.value)}
                            />
                            <Text className={classes.fieldHint}>
                                {locConstants.schemaDesigner.customRestPathHelp}
                            </Text>
                        </Field>

                        {isStoredProcedure && (
                            <Field label={locConstants.schemaDesigner.storedProcedureRestMethods}>
                                <div className={classes.methodGroup}>
                                    {Object.values(Dab.RestMethod).map((method) => (
                                        <Checkbox
                                            key={method}
                                            checked={storedProcedureRestMethods.includes(method)}
                                            disabled={!isRestSectionEnabled}
                                            onChange={(_, data) =>
                                                updateStoredProcedureRestMethod(
                                                    method,
                                                    !!data.checked,
                                                )
                                            }
                                            label={method.toUpperCase()}
                                        />
                                    ))}
                                </div>
                                <Text className={classes.fieldHint}>
                                    {locConstants.schemaDesigner.storedProcedureRestMethodsHelp}
                                </Text>
                            </Field>
                        )}

                        {/* Custom GraphQL Type */}
                        <Field label={locConstants.schemaDesigner.customGraphQLType}>
                            <div className={classes.checkboxGroup}>
                                <Checkbox
                                    checked={isEntityGraphQLEnabled}
                                    disabled={!isGraphQLEnabled}
                                    onChange={(_, data) => updateGraphQLEnabled(!!data.checked)}
                                    label={locConstants.schemaDesigner.enableGraphQLForEntity}
                                />
                                {!isGraphQLEnabled && (
                                    <Text className={classes.fieldHint}>
                                        {locConstants.schemaDesigner.enableGraphQLForEntityHelp}
                                    </Text>
                                )}
                            </div>
                            <Input
                                value={localSettings.customGraphQLType ?? ""}
                                placeholder={entity.sourceName ?? entity.tableName}
                                disabled={!isGraphQLSectionEnabled}
                                onChange={(_, data) => updateCustomGraphQLType(data.value)}
                            />
                            <Text className={classes.fieldHint}>
                                {locConstants.schemaDesigner.customGraphQLTypeHelp}
                            </Text>
                        </Field>

                        {isStoredProcedure && (
                            <Field
                                label={locConstants.schemaDesigner.storedProcedureGraphQLOperation}>
                                <RadioGroup
                                    value={storedProcedureGraphQLOperation}
                                    disabled={!isGraphQLSectionEnabled}
                                    layout="horizontal"
                                    onChange={(_, data) =>
                                        updateStoredProcedureGraphQLOperation(
                                            data.value as Dab.GraphQLOperation,
                                        )
                                    }>
                                    <Radio
                                        value={Dab.GraphQLOperation.Mutation}
                                        label={locConstants.schemaDesigner.graphqlMutation}
                                    />
                                    <Radio
                                        value={Dab.GraphQLOperation.Query}
                                        label={locConstants.schemaDesigner.graphqlQuery}
                                    />
                                </RadioGroup>
                                <Text className={classes.fieldHint}>
                                    {
                                        locConstants.schemaDesigner
                                            .storedProcedureGraphQLOperationHelp
                                    }
                                </Text>
                            </Field>
                        )}

                        {isStoredProcedure && (
                            <Field label={locConstants.schemaDesigner.mcpCustomTool}>
                                <Checkbox
                                    checked={exposeAsMcpCustomTool}
                                    disabled={!isMcpEnabled}
                                    onChange={(_, data) =>
                                        updateExposeAsMcpCustomTool(!!data.checked)
                                    }
                                    label={locConstants.schemaDesigner.exposeAsMcpCustomTool}
                                />
                                <Text className={classes.fieldHint}>{mcpCustomToolHelpText}</Text>
                            </Field>
                        )}
                    </DialogContent>
                    <DialogActions className={classes.actions}>
                        <Button
                            appearance="secondary"
                            className={classes.actionButton}
                            onClick={handleCancel}>
                            {locConstants.common.cancel}
                        </Button>
                        <Button
                            appearance="primary"
                            className={classes.actionButton}
                            onClick={handleApply}>
                            {locConstants.schemaDesigner.applyChanges}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
}
