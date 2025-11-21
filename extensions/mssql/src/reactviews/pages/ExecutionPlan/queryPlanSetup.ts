/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ColorThemeKind } from "../../../sharedInterfaces/webview";
import { themeType } from "../../common/utils";

const iterator_catch_all = require("./icons/iterator_catch_all.png");
const cursor_catch_all = require("./icons/cursor_catch_all.png");
const language_construct_catch_all = require("./icons/language_construct_catch_all.png");
const adaptive_join = require("./icons/adaptive_join.png");
const assert = require("./icons/assert.png");
const bitmap = require("./icons/bitmap.png");
const clustered_index_delete = require("./icons/clustered_index_delete.png");
const clustered_index_insert = require("./icons/clustered_index_insert.png");
const clustered_index_scan = require("./icons/clustered_index_scan.png");
const clustered_index_seek = require("./icons/clustered_index_seek.png");
const clustered_index_update = require("./icons/clustered_index_update.png");
const clustered_index_merge = require("./icons/clustered_index_merge.png");
const clustered_update = require("./icons/clustered_update.png");
const collapse = require("./icons/collapse.png");
const compute_scalar = require("./icons/compute_scalar.png");
const concatenation = require("./icons/concatenation.png");
const constant_scan = require("./icons/constant_scan.png");
const deleted_scan = require("./icons/deleted_scan.png");
const filter = require("./icons/filter.png");
const hash_match = require("./icons/hash_match.png");
const index_delete = require("./icons/index_delete.png");
const index_insert = require("./icons/index_insert.png");
const index_scan = require("./icons/index_scan.png");
const columnstore_index_delete = require("./icons/columnstore_index_delete.png");
const columnstore_index_insert = require("./icons/columnstore_index_insert.png");
const columnstore_index_merge = require("./icons/columnstore_index_merge.png");
const columnstore_index_scan = require("./icons/columnstore_index_scan.png");
const columnstore_index_update = require("./icons/columnstore_index_update.png");
const index_seek = require("./icons/index_seek.png");
const index_spool = require("./icons/index_spool.png");
const index_update = require("./icons/index_update.png");
const inserted_scan = require("./icons/inserted_scan.png");
const log_row_scan = require("./icons/log_row_scan.png");
const merge_interval = require("./icons/merge_interval.png");
const merge_join = require("./icons/merge_join.png");
const nested_loops = require("./icons/nested_loops.png");
const parallelism = require("./icons/parallelism.png");
const parameter_table_scan = require("./icons/parameter_table_scan.png");
const print = require("./icons/print.png");
const rank = require("./icons/rank.png");
const foreign_key_references_check = require("./icons/foreign_key_references_check.png");
const remote_delete = require("./icons/remote_delete.png");
const remote_index_scan = require("./icons/remote_index_scan.png");
const remote_index_seek = require("./icons/remote_index_seek.png");
const remote_insert = require("./icons/remote_insert.png");
const remote_query = require("./icons/remote_query.png");
const remote_scan = require("./icons/remote_scan.png");
const remote_update = require("./icons/remote_update.png");
const rid_lookup = require("./icons/rid_lookup.png");
const row_count_spool = require("./icons/row_count_spool.png");
const segment = require("./icons/segment.png");
const sequence = require("./icons/sequence.png");
const sequence_project = require("./icons/sequence_project.png");
const sort = require("./icons/sort.png");
const split = require("./icons/split.png");
const stream_aggregate = require("./icons/stream_aggregate.png");
const switchStatement = require("./icons/switch.png");
const table_valued_function = require("./icons/table_valued_function.png");
const table_delete = require("./icons/table_delete.png");
const table_insert = require("./icons/table_insert.png");
const table_scan = require("./icons/table_scan.png");
const table_spool = require("./icons/table_spool.png");
const table_update = require("./icons/table_update.png");
const table_merge = require("./icons/table_merge.png");
const tfp = require("./icons/predict.png");
const top = require("./icons/top.png");
const udx = require("./icons/udx.png");
const batch_hash_table_build = require("./icons/batch_hash_table_build.png");
const window_spool = require("./icons/table_spool.png");
const window_aggregate = require("./icons/window_aggregate.png");
const fetch_query = require("./icons/fetch_query.png");
const populate_query = require("./icons/population_query.png");
const refresh_query = require("./icons/refresh_query.png");
const result = require("./icons/result.png");
const aggregate = require("./icons/aggregate.png");

const assign = require("./icons/assign.png");
const arithmetic_expression = require("./icons/arithmetic_expression.png");
const bookmark_lookup = require("./icons/bookmark_lookup.png");
const convert = require("./icons/convert.png");
const declare = require("./icons/declare.png");
const deleteOperator = require("./icons/delete.png");
const dynamic = require("./icons/dynamic.png");
const hash_match_root = require("./icons/hash_match_root.png");
const hash_match_team = require("./icons/hash_match_team.png");
const ifOperator = require("./icons/if.png");
const insert = require("./icons/insert.png");
const intrinsic = require("./icons/intrinsic.png");
const keyset = require("./icons/keyset.png");
const locate = require("./icons/locate.png");
const populationQuery = require("./icons/population_query.png");
const setFunction = require("./icons/set_function.png");
const snapshot = require("./icons/snapshot.png");
const spool = require("./icons/spool.png");
const tsql = require("./icons/sql.png");
const update = require("./icons/update.png");
const keyLookup = require("./icons/bookmark_lookup.png");
const apply = require("./icons/apply.png");
const broadcast = require("./icons/broadcast.png");
const computeToControlNode = require("./icons/compute_to_control_node.png");
const constTableGet = require("./icons/const_table_get.png");
const controlToComputeNodes = require("./icons/control_to_compute_nodes.png");
const externalBroadcast = require("./icons/external_broadcast.png");

const externalExport = require("./icons/external_export.png");
const externalLocalStreaming = require("./icons/external_local_streaming.png");
const externalRoundRobin = require("./icons/external_round_robin.png");
const externalShuffle = require("./icons/external_shuffle.png");
const get = require("./icons/get.png");
const groupByApply = require("./icons/apply.png");
const groupByAggregate = require("./icons/group_by_aggregate.png");
const join = require("./icons/join.png");
const localCube = require("./icons/intrinsic.png");
const project = require("./icons/project.png");
const shuffle = require("./icons/shuffle.png");
const singleSourceRoundRobin = require("./icons/single_source_round_robin.png");
const singleSourceShuffle = require("./icons/single_source_shuffle.png");
const trim = require("./icons/trim.png");
const union = require("./icons/union.png");
const unionAll = require("./icons/union_all.png");

const warning = require("./icons/overlay-warning.svg");
const criticalWarning = require("./icons/badge_critical_warning.svg");
const parallelismBadge = require("./icons/overlay-parallelism.svg");

export function getIconPaths() {
  return {
    // generic icons
    iteratorCatchAll: iterator_catch_all,

    cursorCatchAll: cursor_catch_all,

    languageConstructCatchAll: language_construct_catch_all,

    // operator icons
    adaptiveJoin: adaptive_join,

    assert: assert,

    bitmap: bitmap,

    clusteredIndexDelete: clustered_index_delete,

    clusteredIndexInsert: clustered_index_insert,

    clusteredIndexScan: clustered_index_scan,

    clusteredIndexSeek: clustered_index_seek,

    clusteredIndexUpdate: clustered_index_update,

    clusteredIndexMerge: clustered_index_merge,

    clusteredUpdate: clustered_update,

    collapse: collapse,

    computeScalar: compute_scalar,

    concatenation: concatenation,

    constantScan: constant_scan,

    deletedScan: deleted_scan,

    filter: filter,

    hashMatch: hash_match,

    indexDelete: index_delete,

    indexInsert: index_insert,

    indexScan: index_scan,

    columnstoreIndexDelete: columnstore_index_delete,

    columnstoreIndexInsert: columnstore_index_insert,

    columnstoreIndexMerge: columnstore_index_merge,

    columnstoreIndexScan: columnstore_index_scan,

    columnstoreIndexUpdate: columnstore_index_update,

    indexSeek: index_seek,

    indexSpool: index_spool,

    indexUpdate: index_update,

    insertedScan: inserted_scan,

    logRowScan: log_row_scan,

    mergeInterval: merge_interval,

    mergeJoin: merge_join,

    nestedLoops: nested_loops,

    parallelism: parallelism,

    parameterTableScan: parameter_table_scan,

    print: print,

    rank: rank,

    foreignKeyReferencesCheck: foreign_key_references_check,

    remoteDelete: remote_delete,

    remoteIndexScan: remote_index_scan,

    remoteIndexSeek: remote_index_seek,

    remoteInsert: remote_insert,

    remoteQuery: remote_query,

    remoteScan: remote_scan,

    remoteUpdate: remote_update,

    ridLookup: rid_lookup,

    rowCountSpool: row_count_spool,

    segment: segment,

    sequence: sequence,

    sequenceProject: sequence_project,

    sort: sort,

    split: split,

    streamAggregate: stream_aggregate,

    switchStatement: switchStatement,

    tableValuedFunction: table_valued_function,

    tableDelete: table_delete,

    tableInsert: table_insert,

    tableScan: table_scan,

    tableSpool: table_spool,

    tableUpdate: table_update,

    tableMerge: table_merge,

    tfp: tfp,

    top: top,

    udx: udx,

    batchHashTableBuild: batch_hash_table_build,

    windowSpool: window_spool,

    windowAggregate: window_aggregate,

    // cursor operators
    fetchQuery: fetch_query,

    populateQuery: populate_query,

    refreshQuery: refresh_query,

    // shiloh operators
    result: result,

    aggregate: aggregate,

    assign: assign,

    arithmeticExpression: arithmetic_expression,

    bookmarkLookup: bookmark_lookup,

    convert: convert,

    declare: declare,

    deleteOperator: deleteOperator,

    dynamic: dynamic,

    hashMatchRoot: hash_match_root,

    hashMatchTeam: hash_match_team,

    ifOperator: ifOperator,

    insert: insert,

    intrinsic: intrinsic,

    keyset: keyset,

    locate: locate,

    populationQuery: populationQuery,

    setFunction: setFunction,

    snapshot: snapshot,

    spool: spool,

    tsql: tsql,

    update: update,

    // fake operators
    keyLookup: keyLookup,

    // PDW operators
    apply: apply,

    broadcast: broadcast,

    computeToControlNode: computeToControlNode,

    constTableGet: constTableGet,

    controlToComputeNodes: controlToComputeNodes,

    externalBroadcast: externalBroadcast,

    externalExport: externalExport,

    externalLocalStreaming: externalLocalStreaming,

    externalRoundRobin: externalRoundRobin,

    externalShuffle: externalShuffle,

    get: get,

    groupByApply: groupByApply,

    groupByAggregate: groupByAggregate,

    join: join,

    localCube: localCube,

    project: project,

    shuffle: shuffle,

    singleSourceRoundRobin: singleSourceRoundRobin,

    singleSourceShuffle: singleSourceShuffle,

    trim: trim,

    union: union,

    unionAll: unionAll,
  };
}

export function getBadgePaths() {
  return {
    warning: warning,

    criticalWarning: criticalWarning,

    parallelism: parallelismBadge,
  };
}

export function getCollapseExpandPaths(colorTheme: ColorThemeKind) {
  const theme = themeType(colorTheme);
  return {
    expand:
      theme === "light"
        ? require("./icons/expand_light.svg")
        : require("./icons/expand_dark.svg"),

    collapse:
      theme === "light"
        ? require("./icons/collapse_light.svg")
        : require("./icons/collapse_dark.svg"),
  };
}

export const save = (colorTheme: ColorThemeKind) => {
  const theme = themeType(colorTheme);
  const saveIcon =
    theme === "dark"
      ? require("./icons/saveDark.svg")
      : require("./icons/save.svg");
  return saveIcon;
};

export const openPlanFile = (colorTheme: ColorThemeKind) => {
  const theme = themeType(colorTheme);
  const openPlanFileIcon =
    theme === "dark"
      ? require("./icons/openPlanFileDark.svg")
      : require("./icons/openPlanFile.svg");
  return openPlanFileIcon;
};

export const openQuery = (colorTheme: ColorThemeKind) => {
  const theme = themeType(colorTheme);
  const openQueryIcon =
    theme === "dark"
      ? require("./icons/openQueryDark.svg")
      : require("./icons/openQuery.svg");
  return openQueryIcon;
};

export const zoomIn = (colorTheme: ColorThemeKind) => {
  const theme = themeType(colorTheme);
  const zoomInIcon =
    theme === "dark"
      ? require("./icons/zoomInDark.svg")
      : require("./icons/zoomIn.svg");
  return zoomInIcon;
};

export const zoomOut = (colorTheme: ColorThemeKind) => {
  const theme = themeType(colorTheme);
  const zoomOutIcon =
    theme === "dark"
      ? require("./icons/zoomOutDark.svg")
      : require("./icons/zoomOut.svg");
  return zoomOutIcon;
};

export const zoomToFit = (colorTheme: ColorThemeKind) => {
  const theme = themeType(colorTheme);
  const zoomToFitIcon =
    theme === "dark"
      ? require("./icons/zoomToFitDark.svg")
      : require("./icons/zoomToFit.svg");
  return zoomToFitIcon;
};

export const customZoom = (colorTheme: ColorThemeKind) => {
  const theme = themeType(colorTheme);
  const customZoomIcon =
    theme === "dark"
      ? require("./icons/customZoomDark.svg")
      : require("./icons/customZoom.svg");
  return customZoomIcon;
};

export const search = (colorTheme: ColorThemeKind) => {
  const theme = themeType(colorTheme);
  const searchIcon =
    theme === "dark"
      ? require("./icons/searchDark.svg")
      : require("./icons/search.svg");
  return searchIcon;
};

export const properties = (colorTheme: ColorThemeKind) => {
  const theme = themeType(colorTheme);
  const propertiesIcon =
    theme === "dark"
      ? require("./icons/openPropertiesDark.svg")
      : require("./icons/openProperties.svg");
  return propertiesIcon;
};

export const highlightOps = (colorTheme: ColorThemeKind) => {
  const theme = themeType(colorTheme);
  const highlightOpsIcon =
    theme === "dark"
      ? require("./icons/highlightExpensiveOperationDark.svg")
      : require("./icons/highlightExpensiveOperation.svg");
  return highlightOpsIcon;
};

export const enableTooltip = (colorTheme: ColorThemeKind) => {
  const theme = themeType(colorTheme);
  const enableTooltipIcon =
    theme === "dark"
      ? require("./icons/enableTooltipDark.svg")
      : require("./icons/enableTooltip.svg");
  return enableTooltipIcon;
};

export const disableTooltip = (colorTheme: ColorThemeKind) => {
  const theme = themeType(colorTheme);
  const disableTooltipIcon =
    theme === "dark"
      ? require("./icons/disableTooltipDark.svg")
      : require("./icons/disableTooltip.svg");
  return disableTooltipIcon;
};

export const sortByImportance = (colorTheme: ColorThemeKind) => {
  const theme = themeType(colorTheme);
  const sortByImportanceIcon =
    theme === "dark"
      ? require("./icons/sortByDisplayOrderDark.svg")
      : require("./icons/sortByDisplayOrder.svg");
  return sortByImportanceIcon;
};

export const sortAlphabetically = (colorTheme: ColorThemeKind) => {
  const theme = themeType(colorTheme);
  const sortAlphabeticallyIcon =
    theme === "dark"
      ? require("./icons/sortAlphabeticallyDark.svg")
      : require("./icons/sortAlphabetically.svg");
  return sortAlphabeticallyIcon;
};

export const sortReverseAlphabetically = (colorTheme: ColorThemeKind) => {
  const theme = themeType(colorTheme);
  const sortReverseAlphabeticallyIcon =
    theme === "dark"
      ? require("./icons/sortReverseAlphabeticallyDark.svg")
      : require("./icons/sortReverseAlphabetically.svg");
  return sortReverseAlphabeticallyIcon;
};

export const filterIcon = (colorTheme: ColorThemeKind) => {
  const theme = themeType(colorTheme);
  const filterIcon =
    theme === "dark"
      ? require("./icons/filterDark.svg")
      : require("./icons/filter.svg");
  return filterIcon;
};

export const expandAll = (colorTheme: ColorThemeKind) => {
  const theme = themeType(colorTheme);
  const expandAllIcon =
    theme === "dark"
      ? require("./icons/expandAllDark.svg")
      : require("./icons/expandAll.svg");
  return expandAllIcon;
};

export const collapseAll = (colorTheme: ColorThemeKind) => {
  const theme = themeType(colorTheme);
  const collapseAllIcon =
    theme === "dark"
      ? require("./icons/collapseAllDark.svg")
      : require("./icons/collapseAll.svg");
  return collapseAllIcon;
};
