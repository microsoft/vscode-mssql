/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, Spinner, Text, tokens } from "@fluentui/react-components";
import { useContext, useEffect, useMemo } from "react";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { DabToolbar } from "./dabToolbar";
import { DabEntityTile } from "./dabEntityTile";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        overflow: "hidden",
    },
    content: {
        flex: 1,
        overflow: "auto",
        padding: "15px",
    },
    entityGrid: {
        display: "flex",
        flexWrap: "wrap",
        gap: "12px",
    },
    loadingContainer: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        gap: "12px",
    },
    emptyState: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "200px",
        color: tokens.colorNeutralForeground3,
    },
});

interface DabPageProps {
    activeView?: SchemaDesigner.SchemaDesignerActiveView;
}

export const DabPage = ({ activeView }: DabPageProps) => {
    const classes = useStyles();
    const context = useContext(SchemaDesignerContext);

    const {
        dabConfig,
        initializeDabConfig,
        syncDabConfigWithSchema,
        isInitialized,
        toggleDabEntity,
        toggleDabEntityAction,
        updateDabEntitySettings,
        dabSchemaFilter,
    } = context;

    // Initialize DAB config when schema is first initialized
    useEffect(() => {
        if (isInitialized && !dabConfig) {
            initializeDabConfig();
        }
    }, [isInitialized, dabConfig, initializeDabConfig]);

    // Sync DAB config with schema when switching to DAB tab
    useEffect(() => {
        const isDabTabActive = activeView === SchemaDesigner.SchemaDesignerActiveView.Dab;

        if (isInitialized && isDabTabActive && dabConfig) {
            // Incremental sync: add new tables, remove deleted ones, keep existing settings
            syncDabConfigWithSchema();
        }
    }, [activeView]);

    // Filter entities based on schema filter
    const filteredEntities = useMemo(() => {
        if (!dabConfig) {
            return [];
        }
        if (!dabSchemaFilter) {
            return dabConfig.entities;
        }
        return dabConfig.entities.filter((e) => e.schemaName === dabSchemaFilter);
    }, [dabConfig, dabSchemaFilter]);

    // Show loading state while schema is being initialized
    if (!isInitialized) {
        return (
            <div className={classes.root}>
                <div className={classes.loadingContainer}>
                    <Spinner size="medium" />
                    <Text>Loading...</Text>
                </div>
            </div>
        );
    }

    // Show loading state while DAB config is being initialized
    if (!dabConfig) {
        return (
            <div className={classes.root}>
                <div className={classes.loadingContainer}>
                    <Spinner size="medium" />
                    <Text>Initializing DAB configuration...</Text>
                </div>
            </div>
        );
    }

    return (
        <div className={classes.root}>
            <DabToolbar />
            <div className={classes.content}>
                {filteredEntities.length === 0 ? (
                    <div className={classes.emptyState}>
                        <Text>No entities found</Text>
                    </div>
                ) : (
                    <div className={classes.entityGrid}>
                        {filteredEntities.map((entity) => (
                            <DabEntityTile
                                key={entity.id}
                                entity={entity}
                                onToggleEnabled={(isEnabled) =>
                                    toggleDabEntity(entity.id, isEnabled)
                                }
                                onToggleAction={(action, isEnabled) =>
                                    toggleDabEntityAction(entity.id, action, isEnabled)
                                }
                                onUpdateSettings={(settings) =>
                                    updateDabEntitySettings(entity.id, settings)
                                }
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
