/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


// const iterator_catch_all = require('./icons/iterator_catch_all.png');
// const cursor_catch_all = require('./icons/cursor_catch_all.png');
// const language_construct_catch_all = require('./icons/language_construct_catch_all.png');
// const adaptive_join = require('./icons/adaptive_join.png');
// const assert = require('./icons/assert.png');
// const bitmap = require('./icons/bitmap.png');
// const clustered_index_delete = require('./icons/clustered_index_delete.png');
// const clustered_index_insert = require('./icons/clustered_index_insert.png');
const clustered_index_scan = require('./icons/clustered_index_scan.png');
const clustered_index_seek = require('./icons/clustered_index_seek.png');
// const clustered_index_update = require('./icons/clustered_index_update.png');
// const clustered_index_merge = require('./icons/clustered_index_merge.png');
// const clustered_update = require('./icons/clustered_update.png');
// const collapse = require('./icons/collapse.png');
const compute_scalar = require('./icons/compute_scalar.png');
const concatenation = require('./icons/concatenation.png');
// const constant_scan = require('./icons/constant_scan.png');
// const deleted_scan = require('./icons/deleted_scan.png');
const filter = require('./icons/filter.png');
const hash_match = require('./icons/hash_match.png');
// const index_delete = require('./icons/index_delete.png');
// const index_insert = require('./icons/index_insert.png');
const index_scan = require('./icons/index_scan.png');
// const columnstore_index_delete = require('./icons/columnstore_index_delete.png');
// const columnstore_index_insert = require('./icons/columnstore_index_insert.png');
// const columnstore_index_merge = require('./icons/columnstore_index_merge.png');
// const columnstore_index_scan = require('./icons/columnstore_index_scan.png');
// const columnstore_index_update = require('./icons/columnstore_index_update.png');
// const index_seek = require('./icons/index_seek.png');
// const index_spool = require('./icons/index_spool.png');
// const index_update = require('./icons/index_update.png');
// const inserted_scan = require('./icons/inserted_scan.png');
// const log_row_scan = require('./icons/log_row_scan.png');
// const merge_interval = require('./icons/merge_interval.png');
const merge_join = require('./icons/merge_join.png');
const nested_loops = require('./icons/nested_loops.png');
// const parallelism = require('./icons/parallelism.png');
// const parameter_table_scan = require('./icons/parameter_table_scan.png');
// const print = require('./icons/print.png');
// const rank = require('./icons/rank.png');
// const foreign_key_references_check = require('./icons/foreign_key_references_check.png');
// const remote_delete = require('./icons/remote_delete.png');
// const remote_index_scan = require('./icons/remote_index_scan.png');
// const remote_index_seek = require('./icons/remote_index_seek.png');
// const remote_insert = require('./icons/remote_insert.png');
// const remote_query = require('./icons/remote_query.png');
// const remote_scan = require('./icons/remote_scan.png');
// const remote_update = require('./icons/remote_update.png');
// const rid_lookup = require('./icons/rid_lookup.png');
// const row_count_spool = require('./icons/row_count_spool.png');
// const segment = require('./icons/segment.png');
// const sequence = require('./icons/sequence.png');
// const sequence_project = require('./icons/sequence_project.png');
// const sort = require('./icons/sort.png');
// const split = require('./icons/split.png');
// const stream_aggregate = require('./icons/stream_aggregate.png');
// const switchStatement = require('./icons/switch.png');
const table_valued_function = require('./icons/table_valued_function.png');
// const table_delete = require('./icons/table_delete.png');
// const table_insert = require('./icons/table_insert.png');
// const table_scan = require('./icons/table_scan.png');
const table_spool = require('./icons/table_spool.png');
// const table_update = require('./icons/table_update.png');
// const table_merge = require('./icons/table_merge.png');
// const tfp = require('./icons/predict.png');
// const top = require('./icons/top.png');
// const udx = require('./icons/udx.png');
// const batch_hash_table_build = require('./icons/batch_hash_table_build.png');
// const window_spool = require('./icons/table_spool.png');
// const window_aggregate = require('./icons/window_aggregate.png');
// const fetch_query = require('./icons/fetch_query.png');
// const populate_query = require('./icons/population_query.png');
// const refresh_query = require('./icons/refresh_query.png');
const result = require('./icons/result.png');
// const aggregate = require('./icons/aggregate.png');

// const assign = require('./icons/assign.png');
// const arithmetic_expression = require('./icons/arithmetic_expression.png');
// const bookmark_lookup = require('./icons/bookmark_lookup.png');
// const convert = require('./icons/convert.png');
// const declare = require('./icons/declare.png');
// const deleteOperator = require('./icons/delete.png');
// const dynamic = require('./icons/dynamic.png');
// const hash_match_root = require('./icons/hash_match_root.png');
// const hash_match_team = require('./icons/hash_match_team.png');
// const ifOperator = require('./icons/if.png');
// const insert = require('./icons/insert.png');
// const intrinsic = require('./icons/intrinsic.png');
// const keyset = require('./icons/keyset.png');
// const locate = require('./icons/locate.png');
// const populationQuery = require('./icons/population_query.png');
// const setFunction = require('./icons/set_function.png');
// const snapshot = require('./icons/snapshot.png');
// const spool = require('./icons/spool.png');
// const tsql = require('./icons/sql.png');
// const update = require('./icons/update.png');
// const keyLookup = require('./icons/bookmark_lookup.png');
// const apply = require('./icons/apply.png');
// const broadcast = require('./icons/broadcast.png');
// const computeToControlNode = require('./icons/compute_to_control_node.png');
// const constTableGet = require('./icons/const_table_get.png');
// const controlToComputeNodes = require('./icons/control_to_compute_nodes.png');
// const externalBroadcast = require('./icons/external_broadcast.png');

// const externalExport = require('./icons/external_export.png');
// const externalLocalStreaming = require('./icons/external_local_streaming.png');
// const externalRoundRobin = require('./icons/external_round_robin.png');
// const externalShuffle = require('./icons/external_shuffle.png');
// const get = require('./icons/get.png');
// const groupByApply = require('./icons/apply.png');
// const groupByAggregate = require('./icons/group_by_aggregate.png');
// const join = require('./icons/join.png');
// const localCube = require('./icons/intrinsic.png');
// const project = require('./icons/project.png');
// const shuffle = require('./icons/shuffle.png');
// const singleSourceRoundRobin = require('./icons/single_source_round_robin.png');
// const singleSourceShuffle = require('./icons/single_source_shuffle.png');
// const trim = require('./icons/trim.png');
// const union = require('./icons/union.png');
// const unionAll = require('./icons/union_all.png');

const warning = require('./icons/overlay-warning.svg');
const criticalWarning = require('./icons/badge_critical_warning.svg');
const parallelismBadge = require('./icons/overlay-parallelism.svg');

const expandButton = require('./icons/expand.svg');
const collapseButton = require('./icons/collapse.svg');

export function getIconPaths(imageBasePath: string) {

	var iconPaths =
	{
		// generic icons
		iteratorCatchAll: imageBasePath + 'iterator_catch_all.png',

		cursorCatchAll: imageBasePath + 'cursor_catch_all.png',

		languageConstructCatchAll: imageBasePath + 'language_construct_catch_all.png',

		// operator icons
		adaptiveJoin: imageBasePath + 'adaptive_join.png',

		assert: imageBasePath + 'assert.png',

		bitmap: imageBasePath + 'bitmap.png',

		clusteredIndexDelete: imageBasePath + 'clustered_index_delete.png',

		clusteredIndexInsert: imageBasePath + 'clustered_index_insert.png',

		clusteredIndexScan: clustered_index_scan,

		clusteredIndexSeek: clustered_index_seek,

		clusteredIndexUpdate: imageBasePath + 'clustered_index_update.png',

		clusteredIndexMerge: imageBasePath + 'clustered_index_merge.png',

		clusteredUpdate: imageBasePath + 'clustered_update.png',

		collapse: imageBasePath + 'collapse.png',

		computeScalar: compute_scalar,

		concatenation: concatenation,

		constantScan: imageBasePath + 'constant_scan.png',

		deletedScan: imageBasePath + 'deleted_scan.png',

		filter: filter,

		hashMatch: hash_match,

		indexDelete: imageBasePath + 'index_delete.png',

		indexInsert: imageBasePath + 'index_insert.png',

		indexScan: index_scan,

		columnstoreIndexDelete: imageBasePath + 'columnstore_index_delete.png',

		columnstoreIndexInsert: imageBasePath + 'columnstore_index_insert.png',

		columnstoreIndexMerge: imageBasePath + 'columnstore_index_merge.png',

		columnstoreIndexScan: imageBasePath + 'columnstore_index_scan.png',

		columnstoreIndexUpdate: imageBasePath + 'columnstore_index_update.png',

		indexSeek: imageBasePath + 'index_seek.png',

		indexSpool: imageBasePath + 'index_spool.png',

		indexUpdate: imageBasePath + 'index_update.png',

		insertedScan: imageBasePath + 'inserted_scan.png',

		logRowScan: imageBasePath + 'log_row_scan.png',

		mergeInterval: imageBasePath + 'merge_interval.png',

		mergeJoin: merge_join,

		nestedLoops: nested_loops,

		parallelism: imageBasePath + 'parallelism.png',

		parameterTableScan: imageBasePath + 'parameter_table_scan.png',

		print: imageBasePath + 'print.png',

		rank: imageBasePath + 'rank.png',

		foreignKeyReferencesCheck: imageBasePath + 'foreign_key_references_check.png',

		remoteDelete: imageBasePath + 'remote_delete.png',

		remoteIndexScan: imageBasePath + 'remote_index_scan.png',

		remoteIndexSeek: imageBasePath + 'remote_index_seek.png',

		remoteInsert: imageBasePath + 'remote_insert.png',

		remoteQuery: imageBasePath + 'remote_query.png',

		remoteScan: imageBasePath + 'remote_scan.png',

		remoteUpdate: imageBasePath + 'remote_update.png',

		ridLookup: imageBasePath + 'rid_lookup.png',

		rowCountSpool: imageBasePath + 'row_count_spool.png',

		segment: imageBasePath + 'segment.png',

		sequence: imageBasePath + 'sequence.png',

		sequenceProject: imageBasePath + 'sequence_project.png',

		sort: imageBasePath + 'sort.png',

		split: imageBasePath + 'split.png',

		streamAggregate: imageBasePath + 'stream_aggregate.png',

		switchStatement: imageBasePath + 'switch.png',

		tableValuedFunction: table_valued_function,

		tableDelete: imageBasePath + 'table_delete.png',

		tableInsert: imageBasePath + 'table_insert.png',

		tableScan: imageBasePath + 'table_scan.png',

		tableSpool: table_spool,

		tableUpdate: imageBasePath + 'table_update.png',

		tableMerge: imageBasePath + 'table_merge.png',

		tfp: imageBasePath + 'predict.png',

		top: imageBasePath + 'top.png',

		udx: imageBasePath + 'udx.png',

		batchHashTableBuild: imageBasePath + 'batch_hash_table_build.png',

		windowSpool: imageBasePath + 'table_spool.png',

		windowAggregate: imageBasePath + 'window_aggregate.png',

		// cursor operators
		fetchQuery: imageBasePath + 'fetch_query.png',

		populateQuery: imageBasePath + 'population_query.png',

		refreshQuery: imageBasePath + 'refresh_query.png',

		// shiloh operators
		result: result,

		aggregate: imageBasePath + 'aggregate.png',

		assign: imageBasePath + 'assign.png',

		arithmeticExpression: imageBasePath + 'arithmetic_expression.png',

		bookmarkLookup: imageBasePath + 'bookmark_lookup.png',

		convert: imageBasePath + 'convert.png',

		declare: imageBasePath + 'declare.png',

		deleteOperator: imageBasePath + 'delete.png',

		dynamic: imageBasePath + 'dynamic.png',

		hashMatchRoot: imageBasePath + 'hash_match_root.png',

		hashMatchTeam: imageBasePath + 'hash_match_team.png',

		ifOperator: imageBasePath + 'if.png',

		insert: imageBasePath + 'insert.png',

		intrinsic: imageBasePath + 'intrinsic.png',

		keyset: imageBasePath + 'keyset.png',

		locate: imageBasePath + 'locate.png',

		populationQuery: imageBasePath + 'population_query.png',

		setFunction: imageBasePath + 'set_function.png',

		snapshot: imageBasePath + 'snapshot.png',

		spool: imageBasePath + 'spool.png',

		tsql: imageBasePath + 'sql.png',

		update: imageBasePath + 'update.png',

		// fake operators
		keyLookup: imageBasePath + 'bookmark_lookup.png',

		// PDW operators
		apply: imageBasePath + 'apply.png',

		broadcast: imageBasePath + 'broadcast.png',

		computeToControlNode: imageBasePath + 'compute_to_control_node.png',

		constTableGet: imageBasePath + 'const_table_get.png',

		controlToComputeNodes: imageBasePath + 'control_to_compute_nodes.png',

		externalBroadcast: imageBasePath + 'external_broadcast.png',

		externalExport: imageBasePath + 'external_export.png',

		externalLocalStreaming: imageBasePath + 'external_local_streaming.png',

		externalRoundRobin: imageBasePath + 'external_round_robin.png',

		externalShuffle: imageBasePath + 'external_shuffle.png',

		get: imageBasePath + 'get.png',

		groupByApply: imageBasePath + 'apply.png',

		groupByAggregate: imageBasePath + 'group_by_aggregate.png',

		join: imageBasePath + 'join.png',

		localCube: imageBasePath + 'intrinsic.png',

		project: imageBasePath + 'project.png',

		shuffle: imageBasePath + 'shuffle.png',

		singleSourceRoundRobin: imageBasePath + 'single_source_round_robin.png',

		singleSourceShuffle: imageBasePath + 'single_source_shuffle.png',

		trim: imageBasePath + 'trim.png',

		union: imageBasePath + 'union.png',

		unionAll: imageBasePath + 'union_all.png'
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
