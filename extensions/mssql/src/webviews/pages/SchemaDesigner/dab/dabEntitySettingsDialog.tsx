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
    Field,
    Input,
    makeStyles,
    mergeClasses,
    Text,
    ToggleButton,
    tokens,
} from "@fluentui/react-components";
import { useEffect, useMemo, useState } from "react";
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
        alignItems: "flex-start",
        padding: "12px",
        minHeight: "60px",
    },
    roleButtonLabel: {
        fontWeight: 600,
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
        gap: "4px",
    },
    roleButtonDescription: {
        fontSize: "11px",
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
});

interface DabEntitySettingsDialogProps {
    entity: Dab.DabEntityConfig;
    entities: Dab.DabEntityConfig[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onApply: (settings: Dab.EntityAdvancedSettings) => Promise<void> | void;
}

export function DabEntitySettingsDialog({
    entity,
    entities,
    open,
    onOpenChange,
    onApply,
}: DabEntitySettingsDialogProps) {
    const classes = useStyles();

    // Local state for form - initialized when dialog opens
    const [localSettings, setLocalSettings] = useState<Dab.EntityAdvancedSettings>(
        entity.advancedSettings,
    );
    const [isApplying, setIsApplying] = useState(false);

    // Reset local state when dialog opens
    useEffect(() => {
        if (open) {
            setLocalSettings(entity.advancedSettings);
            setIsApplying(false);
        }
    }, [open, entity.advancedSettings]);

    const normalizeIdentifier = (value: string) => value.trim().toLowerCase();
    const normalizeRestPath = (value: string) => {
        const trimmed = value.trim();
        return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    };
    const hasUnsafeConfigText = (value: string) =>
        /<\s*\/?\s*script\b/i.test(value) ||
        /<[^>]+>/.test(value) ||
        /;\s*(drop|delete|insert|update|alter|create|truncate)\b/i.test(value) ||
        /--/.test(value) ||
        /[\u0000-\u001f\u007f]/.test(value);

    const validation = useMemo(() => {
        const result: Partial<Record<keyof Dab.EntityAdvancedSettings, string>> = {};
        const entityName = localSettings.entityName?.trim() ?? "";
        if (!entityName) {
            result.entityName = locConstants.schemaDesigner.entityNameRequired;
        } else if (entityName.length > 128) {
            result.entityName = locConstants.schemaDesigner.entityNameTooLong;
        } else if (hasUnsafeConfigText(entityName)) {
            result.entityName = locConstants.schemaDesigner.entityNameUnsafe;
        } else if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(entityName)) {
            result.entityName = locConstants.schemaDesigner.entityNameInvalid;
        } else if (
            entities.some(
                (candidate) =>
                    candidate.id !== entity.id &&
                    normalizeIdentifier(candidate.advancedSettings.entityName) ===
                        normalizeIdentifier(entityName),
            )
        ) {
            result.entityName = locConstants.schemaDesigner.entityNameDuplicate;
        }

        const customRestPath = localSettings.customRestPath?.trim();
        if (customRestPath) {
            const normalizedPath = normalizeRestPath(customRestPath);
            if (customRestPath.length > 128) {
                result.customRestPath = locConstants.schemaDesigner.customRestPathTooLong;
            } else if (hasUnsafeConfigText(customRestPath)) {
                result.customRestPath = locConstants.schemaDesigner.customRestPathUnsafe;
            } else if (!/^\/[A-Za-z0-9][A-Za-z0-9/_-]*$/.test(normalizedPath)) {
                result.customRestPath = locConstants.schemaDesigner.customRestPathInvalid;
            } else if (normalizedPath.includes("//")) {
                result.customRestPath = locConstants.schemaDesigner.customRestPathEmptySegments;
            } else if (
                entity.isEnabled &&
                entities.some(
                    (candidate) =>
                        candidate.id !== entity.id &&
                        candidate.isEnabled &&
                        candidate.advancedSettings.customRestPath &&
                        normalizeRestPath(candidate.advancedSettings.customRestPath)
                            .trim()
                            .toLowerCase() === normalizedPath.toLowerCase(),
                )
            ) {
                result.customRestPath = locConstants.schemaDesigner.customRestPathDuplicate;
            }
        }

        const customGraphQLType = localSettings.customGraphQLType?.trim();
        if (customGraphQLType) {
            if (customGraphQLType.length > 128) {
                result.customGraphQLType = locConstants.schemaDesigner.customGraphQLTypeTooLong;
            } else if (hasUnsafeConfigText(customGraphQLType)) {
                result.customGraphQLType = locConstants.schemaDesigner.customGraphQLTypeUnsafe;
            } else if (
                !/^[_A-Za-z][_0-9A-Za-z]*$/.test(customGraphQLType) ||
                customGraphQLType.startsWith("__")
            ) {
                result.customGraphQLType = locConstants.schemaDesigner.customGraphQLTypeInvalid;
            } else if (
                entity.isEnabled &&
                entities.some(
                    (candidate) =>
                        candidate.id !== entity.id &&
                        candidate.isEnabled &&
                        candidate.advancedSettings.customGraphQLType &&
                        normalizeIdentifier(candidate.advancedSettings.customGraphQLType) ===
                            normalizeIdentifier(customGraphQLType),
                )
            ) {
                result.customGraphQLType = locConstants.schemaDesigner.customGraphQLTypeDuplicate;
            }
        }

        return result;
    }, [entities, entity.id, entity.isEnabled, localSettings]);

    const hasValidationErrors = Object.keys(validation).length > 0;

    const handleApply = async () => {
        if (hasValidationErrors || isApplying) {
            return;
        }
        setIsApplying(true);
        try {
            await onApply({
                ...localSettings,
                entityName: localSettings.entityName.trim(),
                customRestPath: localSettings.customRestPath?.trim() || undefined,
                customGraphQLType: localSettings.customGraphQLType?.trim() || undefined,
            });
        } finally {
            setIsApplying(false);
        }
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

    const updateCustomGraphQLType = (value: string) => {
        setLocalSettings((prev) => ({ ...prev, customGraphQLType: value || undefined }));
    };

    const isAnonymousSelected = localSettings.authorizationRole === Dab.AuthorizationRole.Anonymous;
    const isAuthenticatedSelected =
        localSettings.authorizationRole === Dab.AuthorizationRole.Authenticated;

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
                            {locConstants.schemaDesigner.sourceTable}: {entity.schemaName}.
                            {entity.tableName}
                        </Text>

                        {/* Entity Name Field */}
                        <Field
                            label={locConstants.schemaDesigner.entityName}
                            validationState={validation.entityName ? "error" : "none"}
                            validationMessage={validation.entityName}>
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
                                        <Text
                                            className={mergeClasses(
                                                classes.roleButtonLabel,
                                                isAnonymousSelected
                                                    ? classes.roleButtonLabelSelected
                                                    : classes.roleButtonLabelUnselected,
                                            )}>
                                            {locConstants.schemaDesigner.anonymous}
                                        </Text>
                                        <Text
                                            className={mergeClasses(
                                                classes.roleButtonDescription,
                                                isAnonymousSelected
                                                    ? classes.roleButtonDescriptionSelected
                                                    : classes.roleButtonDescriptionUnselected,
                                            )}>
                                            {locConstants.schemaDesigner.anonymousDescription}
                                        </Text>
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
                                        <Text
                                            className={mergeClasses(
                                                classes.roleButtonLabel,
                                                isAuthenticatedSelected
                                                    ? classes.roleButtonLabelSelected
                                                    : classes.roleButtonLabelUnselected,
                                            )}>
                                            {locConstants.schemaDesigner.authenticated}
                                        </Text>
                                        <Text
                                            className={mergeClasses(
                                                classes.roleButtonDescription,
                                                isAuthenticatedSelected
                                                    ? classes.roleButtonDescriptionSelected
                                                    : classes.roleButtonDescriptionUnselected,
                                            )}>
                                            {locConstants.schemaDesigner.authenticatedDescription}
                                        </Text>
                                    </div>
                                </ToggleButton>
                            </div>
                        </Field>

                        {/* Custom REST Path */}
                        <Field
                            label={locConstants.schemaDesigner.customRestPath}
                            validationState={validation.customRestPath ? "error" : "none"}
                            validationMessage={validation.customRestPath}>
                            <Input
                                value={localSettings.customRestPath ?? ""}
                                placeholder={entity.tableName.toLowerCase()}
                                onChange={(_, data) => updateCustomRestPath(data.value)}
                            />
                            <Text className={classes.fieldHint}>
                                {locConstants.schemaDesigner.customRestPathHelp}
                            </Text>
                        </Field>

                        {/* Custom GraphQL Type */}
                        <Field
                            label={locConstants.schemaDesigner.customGraphQLType}
                            validationState={validation.customGraphQLType ? "error" : "none"}
                            validationMessage={validation.customGraphQLType}>
                            <Input
                                value={localSettings.customGraphQLType ?? ""}
                                placeholder={entity.tableName}
                                onChange={(_, data) => updateCustomGraphQLType(data.value)}
                            />
                            <Text className={classes.fieldHint}>
                                {locConstants.schemaDesigner.customGraphQLTypeHelp}
                            </Text>
                        </Field>
                    </DialogContent>
                    <DialogActions>
                        <Button appearance="secondary" onClick={handleCancel}>
                            {locConstants.common.cancel}
                        </Button>
                        <Button
                            appearance="primary"
                            disabled={hasValidationErrors || isApplying}
                            onClick={handleApply}>
                            {locConstants.schemaDesigner.applyChanges}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
}
