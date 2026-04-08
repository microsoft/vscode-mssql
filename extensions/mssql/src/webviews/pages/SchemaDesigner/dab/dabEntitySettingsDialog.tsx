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
        alignItems: "flex-start",
        padding: "12px",
        minHeight: "60px",
    },
    roleButtonLabel: {
        fontWeight: 600,
    },
    roleButtonContent: {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
    },
    roleButtonDescription: {
        fontSize: "11px",
        color: tokens.colorNeutralForeground4,
    },
    sourceTableText: {
        fontSize: "12px",
        color: tokens.colorNeutralForeground3,
        marginBottom: "8px",
    },
});

interface DabEntitySettingsDialogProps {
    entity: Dab.DabEntityConfig;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onApply: (settings: Dab.EntityAdvancedSettings) => void;
}

export function DabEntitySettingsDialog({
    entity,
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

    const updateCustomGraphQLType = (value: string) => {
        setLocalSettings((prev) => ({ ...prev, customGraphQLType: value || undefined }));
    };

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
                                    appearance={
                                        localSettings.authorizationRole ===
                                        Dab.AuthorizationRole.Anonymous
                                            ? "primary"
                                            : "outline"
                                    }
                                    checked={
                                        localSettings.authorizationRole ===
                                        Dab.AuthorizationRole.Anonymous
                                    }
                                    onClick={() =>
                                        updateAuthorizationRole(Dab.AuthorizationRole.Anonymous)
                                    }>
                                    <div className={classes.roleButtonContent}>
                                        <Text className={classes.roleButtonLabel}>
                                            {locConstants.schemaDesigner.anonymous}
                                        </Text>
                                        <Text className={classes.roleButtonDescription}>
                                            {locConstants.schemaDesigner.anonymousDescription}
                                        </Text>
                                    </div>
                                </ToggleButton>
                                <ToggleButton
                                    className={classes.roleButton}
                                    appearance={
                                        localSettings.authorizationRole ===
                                        Dab.AuthorizationRole.Authenticated
                                            ? "primary"
                                            : "outline"
                                    }
                                    checked={
                                        localSettings.authorizationRole ===
                                        Dab.AuthorizationRole.Authenticated
                                    }
                                    onClick={() =>
                                        updateAuthorizationRole(Dab.AuthorizationRole.Authenticated)
                                    }>
                                    <div className={classes.roleButtonContent}>
                                        <Text className={classes.roleButtonLabel}>
                                            {locConstants.schemaDesigner.authenticated}
                                        </Text>
                                        <Text className={classes.roleButtonDescription}>
                                            {locConstants.schemaDesigner.authenticatedDescription}
                                        </Text>
                                    </div>
                                </ToggleButton>
                            </div>
                        </Field>

                        {/* Custom REST Path */}
                        <Field label={locConstants.schemaDesigner.customRestPath}>
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
                        <Field label={locConstants.schemaDesigner.customGraphQLType}>
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
                        <Button appearance="primary" onClick={handleApply}>
                            {locConstants.schemaDesigner.applyChanges}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
}
