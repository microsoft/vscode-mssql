/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


const iterator_catch_all = require('./images/icons/iterator_catch_all.png');
const cursor_catch_all = require('./images/icons/cursor_catch_all.png');
const language_construct_catch_all = require('./images/icons/language_construct_catch_all.png');
const adaptive_join = require('./images/icons/adaptive_join.png');
const assert = require('./images/icons/assert.png');
const bitmap = require('./images/icons/bitmap.png');
const clustered_index_delete = require('./images/icons/clustered_index_delete.png');
const clustered_index_insert = require('./images/icons/clustered_index_insert.png');
const clustered_index_scan = require('./images/icons/clustered_index_scan.png');
const clustered_index_seek = require('./images/icons/clustered_index_seek.png');
const clustered_index_update = require('./images/icons/clustered_index_update.png');
const clustered_index_merge = require('./images/icons/clustered_index_merge.png');
const clustered_update = require('./images/icons/clustered_update.png');
const collapse = require('./images/icons/collapse.png');
const compute_scalar = require('./images/icons/compute_scalar.png');
const concatenation = require('./images/icons/concatenation.png');
const constant_scan = require('./images/icons/constant_scan.png');
const deleted_scan = require('./images/icons/deleted_scan.png');
const filter = require('./images/icons/filter.png');
const hash_match = require('./images/icons/hash_match.png');
const index_delete = require('./images/icons/index_delete.png');
const index_insert = require('./images/icons/index_insert.png');
const index_scan = require('./images/icons/index_scan.png');
const columnstore_index_delete = require('./images/icons/columnstore_index_delete.png');
const columnstore_index_insert = require('./images/icons/columnstore_index_insert.png');
const columnstore_index_merge = require('./images/icons/columnstore_index_merge.png');
const columnstore_index_scan = require('./images/icons/columnstore_index_scan.png');
const columnstore_index_update = require('./images/icons/columnstore_index_update.png');
const index_seek = require('./images/icons/index_seek.png');
const index_spool = require('./images/icons/index_spool.png');
const index_update = require('./images/icons/index_update.png');
const inserted_scan = require('./images/icons/inserted_scan.png');
const log_row_scan = require('./images/icons/log_row_scan.png');
const merge_interval = require('./images/icons/merge_interval.png');
const merge_join = require('./images/icons/merge_join.png');
const nested_loops = require('./images/icons/nested_loops.png');
const parallelism = require('./images/icons/parallelism.png');
const parameter_table_scan = require('./images/icons/parameter_table_scan.png');
const print = require('./images/icons/print.png');
const rank = require('./images/icons/rank.png');
const foreign_key_references_check = require('./images/icons/foreign_key_references_check.png');
const remote_delete = require('./images/icons/remote_delete.png');
const remote_index_scan = require('./images/icons/remote_index_scan.png');
const remote_index_seek = require('./images/icons/remote_index_seek.png');
const remote_insert = require('./images/icons/remote_insert.png');
const remote_query = require('./images/icons/remote_query.png');
const remote_scan = require('./images/icons/remote_scan.png');
const remote_update = require('./images/icons/remote_update.png');
const rid_lookup = require('./images/icons/rid_lookup.png');
const row_count_spool = require('./images/icons/row_count_spool.png');
const segment = require('./images/icons/segment.png');
const sequence = require('./images/icons/sequence.png');
const sequence_project = require('./images/icons/sequence_project.png');
const sort = require('./images/icons/sort.png');
const split = require('./images/icons/split.png');
const stream_aggregate = require('./images/icons/stream_aggregate.png');
const switchStatement = require('./images/icons/switch.png');
const table_valued_function = require('./images/icons/table_valued_function.png');
const table_delete = require('./images/icons/table_delete.png');
const table_insert = require('./images/icons/table_insert.png');
const table_scan = require('./images/icons/table_scan.png');
const table_spool = require('./images/icons/table_spool.png');
const table_update = require('./images/icons/table_update.png');
const table_merge = require('./images/icons/table_merge.png');
const tfp = require('./images/icons/predict.png');
const top = require('./images/icons/top.png');
const udx = require('./images/icons/udx.png');
const batch_hash_table_build = require('./images/icons/batch_hash_table_build.png');
const window_spool = require('./images/icons/table_spool.png');
const window_aggregate = require('./images/icons/window_aggregate.png');
const fetch_query = require('./images/icons/fetch_query.png');
const populate_query = require('./images/icons/population_query.png');
const refresh_query = require('./images/icons/refresh_query.png');
const result = require('./images/icons/result.png');
const aggregate = require('./images/icons/aggregate.png');

const assign = require('./images/icons/assign.png');
const arithmetic_expression = require('./images/icons/arithmetic_expression.png');
const bookmark_lookup = require('./images/icons/bookmark_lookup.png');
const convert = require('./images/icons/convert.png');
const declare = require('./images/icons/declare.png');
const deleteOperator = require('./images/icons/delete.png');
const dynamic = require('./images/icons/dynamic.png');
const hash_match_root = require('./images/icons/hash_match_root.png');
const hash_match_team = require('./images/icons/hash_match_team.png');
const ifOperator = require('./images/icons/if.png');
const insert = require('./images/icons/insert.png');
const intrinsic = require('./images/icons/intrinsic.png');
const keyset = require('./images/icons/keyset.png');
const locate = require('./images/icons/locate.png');
const populationQuery = require('./images/icons/population_query.png');
const setFunction = require('./images/icons/set_function.png');
const snapshot = require('./images/icons/snapshot.png');
const spool = require('./images/icons/spool.png');
const tsql = require('./images/icons/sql.png');
const update = require('./images/icons/update.png');
const keyLookup = require('./images/icons/bookmark_lookup.png');
const apply = require('./images/icons/apply.png');
const broadcast = require('./images/icons/broadcast.png');
const computeToControlNode = require('./images/icons/compute_to_control_node.png');
const constTableGet = require('./images/icons/const_table_get.png');
const controlToComputeNodes = require('./images/icons/control_to_compute_nodes.png');
const externalBroadcast = require('./images/icons/external_broadcast.png');

const externalExport = require('./images/icons/external_export.png');
const externalLocalStreaming = require('./images/icons/external_local_streaming.png');
const externalRoundRobin = require('./images/icons/external_round_robin.png');
const externalShuffle = require('./images/icons/external_shuffle.png');
const get = require('./images/icons/get.png');
const groupByApply = require('./images/icons/apply.png');
const groupByAggregate = require('./images/icons/group_by_aggregate.png');
const join = require('./images/icons/join.png');
const localCube = require('./images/icons/intrinsic.png');
const project = require('./images/icons/project.png');
const shuffle = require('./images/icons/shuffle.png');
const singleSourceRoundRobin = require('./images/icons/single_source_round_robin.png');
const singleSourceShuffle = require('./images/icons/single_source_shuffle.png');
const trim = require('./images/icons/trim.png');
const union = require('./images/icons/union.png');
const unionAll = require('./images/icons/union_all.png');

const warning = require('./images/icons/overlay-warning.svg');
const criticalWarning = require('./images/icons/badge_critical_warning.svg');
const parallelismBadge = require('./images/icons/overlay-parallelism.svg');

const expandButton = require('./images/icons/expand.svg');
const collapseButton = require('./images/icons/collapse.svg');

export function getIconPaths() {

	var iconPaths =
	{
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

		unionAll: unionAll
	};

	return iconPaths;
}

export function getBadgePaths() {
	return {
		warning: warning,

		criticalWarning: criticalWarning,

		parallelism: parallelismBadge
	};
}

export function getCollapseExpandPaths() {
	return {
		expand: expandButton,

		collapse: collapseButton
	};
}