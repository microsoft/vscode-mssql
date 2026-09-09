/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OverviewActionId } from "../../../sharedInterfaces/overview";
import { locConstants } from "../../common/locConstants";
import { overviewLinks } from "./overviewContent";

const connectToDatabaseImage = require("../../../../images/walkthroughs/connectToDatabase.png");
const objectExplorerImage = require("../../../../images/walkthroughs/objectExplorerFilters.png");
const runQueriesImage = require("../../../../images/walkthroughs/runQueries.png");
const resultsGridImage = require("../../../../images/walkthroughs/sortAndFilterQueryResults.png");
const queryPlanImage = require("../../../../images/walkthroughs/viewQueryPlan.png");
const newTableImage = require("../../../../images/walkthroughs/createNewTable.png");

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
                [
                    "generateTestData",
                    loc.featureGenerateTestDataTitle,
                    loc.featureGenerateTestDataDescription,
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
                            actionId: OverviewActionId.ExecuteQuery,
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
                        id: "designSchema",
                        title: loc.wtAppStep1Title,
                        description: loc.wtAppStep1Description,
                        // Schema Designer is opened from a database node, so this step points
                        // the user at the tree rather than running a command that needs one.
                        action: {
                            label: loc.wtConnectStep2Action,
                            actionId: OverviewActionId.FocusConnections,
                        },
                        image: newTableImage,
                    },
                    {
                        id: "generateDataApi",
                        title: loc.wtAppStep2Title,
                        description: loc.wtAppStep2Description,
                        action: {
                            label: loc.wtConnectStep2Action,
                            actionId: OverviewActionId.FocusConnections,
                        },
                    },
                    {
                        id: "connectApp",
                        title: loc.wtAppStep3Title,
                        description: loc.wtAppStep3Description,
                        action: {
                            label: loc.wtConnectStep2Action,
                            actionId: OverviewActionId.FocusConnections,
                        },
                    },
                    {
                        id: "runAndIterate",
                        title: loc.wtAppStep4Title,
                        description: loc.wtAppStep4Description,
                        image: queryPlanImage,
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
                        id: "chatWithMssql",
                        title: loc.wtCopilotStep1Title,
                        description: loc.wtCopilotStep1Description,
                        action: {
                            label: loc.wtCopilotStep1Action,
                            actionId: OverviewActionId.OpenCopilotChat,
                        },
                    },
                    {
                        id: "chatWithDatabase",
                        title: loc.wtCopilotStep2Title,
                        description: loc.wtCopilotStep2Description,
                        action: {
                            label: loc.wtConnectStep2Action,
                            actionId: OverviewActionId.FocusConnections,
                        },
                    },
                    {
                        id: "agentMode",
                        title: loc.wtCopilotStep3Title,
                        description: loc.wtCopilotStep3Description,
                        action: {
                            label: loc.wtCopilotStep1Action,
                            actionId: OverviewActionId.OpenCopilotChat,
                        },
                    },
                    {
                        id: "schemaAwareEdits",
                        title: loc.wtCopilotStep4Title,
                        description: loc.wtCopilotStep4Description,
                        action: {
                            label: loc.wtCopilotStep4Action,
                            url: overviewLinks.copilotDocumentation,
                        },
                    },
                ],
            };
    }
}
