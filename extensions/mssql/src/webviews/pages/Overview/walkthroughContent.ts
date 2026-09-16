/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OverviewActionId } from "../../../sharedInterfaces/overview";
import { locConstants } from "../../common/locConstants";
import { overviewLinks } from "./overviewContent";

const connectToDatabaseImage = require("../../../../images/walkthroughs/connectAndRun/connection.gif");
const objectExplorerImage = require("../../../../images/walkthroughs/connectAndRun/object-explorer.gif");
const runQueriesImage = require("../../../../images/walkthroughs/connectAndRun/new-query.gif");
const resultsGridImage = require("../../../../images/walkthroughs/connectAndRun/query-results.gif");

const localContainerImage = require("../../../../images/walkthroughs/buildApp/local-container.gif");
const newDatabaseImage = require("../../../../images/walkthroughs/buildApp/new-database.gif");
const schemaDesignerImage = require("../../../../images/walkthroughs/buildApp/schema-designer.gif");
const editDataImage = require("../../../../images/walkthroughs/buildApp/edit-data.gif");
const dataApiBuilderImage = require("../../../../images/walkthroughs/buildApp/dab.gif");
const runAppImage = require("../../../../images/walkthroughs/buildApp/run-app.gif");

const copilotAgentModeImage = require("../../../../images/walkthroughs/copilot/agent-mode.gif");

const featureImages: Partial<Record<string, string>> = {
    schemaDesigner: require("../../../../images/walkthroughs/features/schema-designer.gif"),
    tableDesigner: require("../../../../images/walkthroughs/features/table-designer.gif"),
    editData: require("../../../../images/walkthroughs/features/edit-data.gif"),
    importFlatFile: require("../../../../images/walkthroughs/features/import-data.gif"),
    queryEditor: require("../../../../images/walkthroughs/features/query-editor.gif"),
    queryPlans: require("../../../../images/walkthroughs/features/query-plan.gif"),
    queryProfiler: require("../../../../images/walkthroughs/features/query-profiler.gif"),
    notebooks: require("../../../../images/walkthroughs/features/notebook.gif"),
    dacpac: require("../../../../images/walkthroughs/features/dacpac-bacpac.gif"),
    backupRestore: require("../../../../images/walkthroughs/features/backup-restore.gif"),
    schemaCompare: require("../../../../images/walkthroughs/features/schema-compare.gif"),
    sqlProjects: require("../../../../images/walkthroughs/features/sql-projects.gif"),
    dataApiBuilder: require("../../../../images/walkthroughs/features/dab.gif"),
};

/** Identifies a walkthrough so a card can open the matching dialog. */
export enum WalkthroughId {
    Connect = "connect",
    App = "app",
    Copilot = "copilot",
    Features = "features",
}

/**
 * A step's call to action. Steps whose real entry point needs a database selected have no
 * action of their own; their description says where to find it instead.
 */
export interface WalkthroughStepAction {
    label: string;
    /** Command to run, for in-product actions. */
    actionId?: OverviewActionId;
    /** External URL, for documentation. */
    url?: string;
}

export interface WalkthroughStep {
    id: string;
    title: string;
    description: string;
    action?: WalkthroughStepAction;
    /** Screenshot for the step. Steps without one fall back to the media placeholder. */
    image?: string;
    /** Gallery grouping. Present only in gallery walkthroughs; drives the nav headings. */
    category?: string;
}

export interface Walkthrough {
    id: WalkthroughId;
    title: string;
    subtitle: string;
    /**
     * "steps" is an ordered sequence and shows "Step n of m"; "gallery" is a browsable set
     * grouped by category, which the kicker shows instead.
     */
    kind: "steps" | "gallery";
    steps: WalkthroughStep[];
}

/** Builds the flat, category-tagged entry list for the Explore features gallery. */
function getFeatureGallery(): WalkthroughStep[] {
    const loc = locConstants.overview;
    const groups: { category: string; items: [string, string, string][] }[] = [
        {
            category: loc.featureGroupDesignSchema,
            items: [
                [
                    "schemaDesigner",
                    loc.featureSchemaDesignerTitle,
                    loc.featureSchemaDesignerDescription,
                ],
                [
                    "tableDesigner",
                    loc.featureTableDesignerTitle,
                    loc.featureTableDesignerDescription,
                ],
            ],
        },
        {
            category: loc.featureGroupAddEditData,
            items: [
                ["editData", loc.featureEditDataTitle, loc.featureEditDataDescription],
                [
                    "importFlatFile",
                    loc.featureImportFlatFileTitle,
                    loc.featureImportFlatFileDescription,
                ],
            ],
        },
        {
            category: loc.featureGroupQueryAnalyze,
            items: [
                ["queryEditor", loc.featureQueryEditorTitle, loc.featureQueryEditorDescription],
                ["queryPlans", loc.featureQueryPlansTitle, loc.featureQueryPlansDescription],
                [
                    "queryProfiler",
                    loc.featureQueryProfilerTitle,
                    loc.featureQueryProfilerDescription,
                ],
                ["notebooks", loc.featureNotebooksTitle, loc.featureNotebooksDescription],
            ],
        },
        {
            category: loc.featureGroupMoveProtect,
            items: [
                ["dacpac", loc.featureDacpacTitle, loc.featureDacpacDescription],
                [
                    "backupRestore",
                    loc.featureBackupRestoreTitle,
                    loc.featureBackupRestoreDescription,
                ],
            ],
        },
        {
            category: loc.featureGroupBuildShip,
            items: [
                [
                    "schemaCompare",
                    loc.featureSchemaCompareTitle,
                    loc.featureSchemaCompareDescription,
                ],
                ["sqlProjects", loc.featureSqlProjectsTitle, loc.featureSqlProjectsDescription],
                [
                    "dataApiBuilder",
                    loc.featureDataApiBuilderTitle,
                    loc.featureDataApiBuilderDescription,
                ],
            ],
        },
    ];

    return groups.flatMap((group) =>
        group.items.map(([id, title, description]) => ({
            id,
            title,
            description,
            category: group.category,
            image: featureImages[id],
        })),
    );
}

export function getWalkthrough(id: WalkthroughId): Walkthrough {
    const loc = locConstants.overview;

    switch (id) {
        case WalkthroughId.Connect:
            return {
                id,
                title: loc.walkthroughConnectTitle,
                subtitle: loc.walkthroughConnectSubtitle,
                kind: "steps",
                steps: [
                    {
                        id: "createConnection",
                        title: loc.wtConnectStep1Title,
                        description: loc.wtConnectStep1Description,
                        action: {
                            label: loc.wtConnectStep1Action,
                            actionId: OverviewActionId.AddConnection,
                        },
                        image: connectToDatabaseImage,
                    },
                    {
                        id: "exploreObjectExplorer",
                        title: loc.wtConnectStep2Title,
                        description: loc.wtConnectStep2Description,
                        action: {
                            label: loc.wtConnectStep2Action,
                            actionId: OverviewActionId.FocusConnections,
                        },
                        image: objectExplorerImage,
                    },
                    {
                        id: "openNewQuery",
                        title: loc.wtConnectStep3Title,
                        description: loc.wtConnectStep3Description,
                        action: {
                            label: loc.wtConnectStep3Action,
                            actionId: OverviewActionId.NewQuery,
                        },
                        image: runQueriesImage,
                    },
                    {
                        id: "runAndReadResults",
                        title: loc.wtConnectStep4Title,
                        description: loc.wtConnectStep4Description,
                        action: {
                            label: loc.wtConnectStep4Action,
                            actionId: OverviewActionId.NewQuery,
                        },
                        image: resultsGridImage,
                    },
                ],
            };

        case WalkthroughId.App:
            return {
                id,
                title: loc.walkthroughAppTitle,
                subtitle: loc.walkthroughAppSubtitle,
                kind: "steps",
                steps: [
                    {
                        id: "createLocalContainer",
                        title: loc.wtAppLocalContainerTitle,
                        description: loc.wtAppLocalContainerDescription,
                        action: {
                            label: loc.wtAppLocalContainerAction,
                            actionId: OverviewActionId.NewLocalContainer,
                        },
                        image: localContainerImage,
                    },
                    {
                        id: "createDatabase",
                        title: loc.wtAppCreateDatabaseTitle,
                        description: loc.wtAppCreateDatabaseDescription,
                        action: {
                            label: loc.wtConnectStep2Action,
                            actionId: OverviewActionId.FocusConnections,
                        },
                        image: newDatabaseImage,
                    },
                    {
                        id: "designSchema",
                        title: loc.wtAppStep1Title,
                        description: loc.wtAppStep1Description,
                        // Schema Designer is opened from a database node, so this step points
                        // the user at the tree rather than running a command that needs one.
                        action: {
                            label: loc.wtConnectStep2Action,
                            actionId: OverviewActionId.FocusConnections,
                        },
                        image: schemaDesignerImage,
                    },
                    {
                        id: "editData",
                        title: loc.wtAppEditDataTitle,
                        description: loc.wtAppEditDataDescription,
                        action: {
                            label: loc.wtConnectStep2Action,
                            actionId: OverviewActionId.FocusConnections,
                        },
                        image: editDataImage,
                    },
                    {
                        id: "generateDataApi",
                        title: loc.wtAppStep2Title,
                        description: loc.wtAppStep2Description,
                        action: {
                            label: loc.wtConnectStep2Action,
                            actionId: OverviewActionId.FocusConnections,
                        },
                        image: dataApiBuilderImage,
                    },
                    {
                        id: "runAndIterate",
                        title: loc.wtAppStep4Title,
                        description: loc.wtAppStep4Description,
                        image: runAppImage,
                    },
                ],
            };

        case WalkthroughId.Features:
            return {
                id,
                title: loc.exploreFeaturesTitle,
                subtitle: loc.exploreFeaturesSubtitle,
                kind: "gallery",
                steps: getFeatureGallery(),
            };

        case WalkthroughId.Copilot:
            return {
                id,
                title: loc.walkthroughCopilotTitle,
                subtitle: loc.walkthroughCopilotSubtitle,
                kind: "steps",
                steps: [
                    {
                        id: "agentMode",
                        title: loc.wtCopilotStep1Title,
                        description: loc.wtCopilotStep1Description,
                        action: {
                            label: loc.wtCopilotLearnMoreAction,
                            url: overviewLinks.copilotWalkthroughDocumentation,
                        },
                        image: copilotAgentModeImage,
                    },
                    {
                        id: "mssqlAskMode",
                        title: loc.wtCopilotStep2Title,
                        description: loc.wtCopilotStep2Description,
                        action: {
                            label: loc.wtCopilotLearnMoreAction,
                            url: overviewLinks.copilotWalkthroughDocumentation,
                        },
                    },
                    {
                        id: "fixExplain",
                        title: loc.wtCopilotStep3Title,
                        description: loc.wtCopilotStep3Description,
                        action: {
                            label: loc.wtCopilotLearnMoreAction,
                            url: overviewLinks.copilotWalkthroughDocumentation,
                        },
                    },
                    {
                        id: "schemaDesignerCopilot",
                        title: loc.wtCopilotStep4Title,
                        description: loc.wtCopilotStep4Description,
                        action: {
                            label: loc.wtCopilotLearnMoreAction,
                            url: overviewLinks.copilotWalkthroughDocumentation,
                        },
                    },
                    {
                        id: "dataApiBuilderCopilot",
                        title: loc.wtCopilotStep5Title,
                        description: loc.wtCopilotStep5Description,
                        action: {
                            label: loc.wtCopilotLearnMoreAction,
                            url: overviewLinks.copilotWalkthroughDocumentation,
                        },
                    },
                ],
            };
    }
}
