/*
 * Derived from SaralSQL commit e95951c1ba48c41c026a1244ac23cedc2ced7fb7.
 * Copyright (c) Saral Simon Stalin. Licensed under the MIT License.
 * See packages/tsql-language-service/third-party/saralsql/LICENSE and NOTICE.md.
 */

// ===============================
// Core Contracts
// ===============================

export type NodeLocation = {
    start: number;
    end: number;
};

export interface ASTNode extends NodeLocation {
    type: string;
}

export interface Recoverable {
    incomplete?: boolean;
    errors?: string[];
}

export interface ParseIssue {
    code: string;
    message: string;
    start: number;
    end: number;
}

// ===============================
// Program Root
// ===============================

export interface Program extends NodeLocation {
    type: "Program";
    body: Statement[];
}

export interface ParseResult {
    ast: Program;
    issues?: ParseIssue[];
}

// ===============================
// Expressions
// ===============================

export type Expression =
    | BinaryExpression
    | UnaryExpression
    | LiteralNode
    | IdentifierNode
    | VariableNode
    | FunctionCallNode
    | CaseExpression
    | InExpression
    | BetweenExpression
    | GroupingExpression
    | SubqueryExpression
    | OverExpression
    | MemberExpression
    | WildcardExpression
    | CastExpression
    | ExistsExpression
    | ValuesTableExpression
    | BuiltInArgumentNode;

export interface BinaryExpression extends NodeLocation, Recoverable {
    type: "BinaryExpression";
    left: Expression;
    operator: string;
    right: Expression | null;
}

export interface UnaryExpression extends NodeLocation, Recoverable {
    type: "UnaryExpression";
    operator: string;
    right: Expression | null;
}

export interface LiteralNode extends NodeLocation {
    type: "Literal";
    value: string | number | null;
    variant: "string" | "number" | "null";
}

export interface IdentifierNode extends NodeLocation, Recoverable {
    type: "Identifier";
    name: string;
    parts: string[];
    tablePrefix?: string;
}

export interface VariableNode extends NodeLocation {
    type: "Variable";
    name: string;
}

export interface FunctionCallNode extends NodeLocation, Recoverable {
    type: "FunctionCall";
    name: string;
    args: Expression[];
    /** Receiver for SQL type methods such as `xmlColumn.nodes(...)` and `node.value(...)`. */
    receiver?: IdentifierNode;
    distinct?: boolean;
    withinGroup?: OrderByNode[];
    openJsonWith?: OpenJsonColumnDefinition[];
    jsonClause?: JsonFunctionClause;
    vectorSearch?: VectorSearchClause;
}

export interface JsonObjectEntry extends NodeLocation {
    key: Expression;
    value: Expression;
}

export interface JsonFunctionClause {
    entries?: JsonObjectEntry[];
    nullHandling?: "NULL ON NULL" | "ABSENT ON NULL";
    returningType?: string;
    arrayWrapper?: boolean;
}

export interface VectorSearchParameter extends NodeLocation {
    name: string;
    value: Expression | null;
    tableAlias?: string;
}

export interface VectorSearchClause {
    parameters: VectorSearchParameter[];
    forIndexCreate?: boolean;
}

export interface PivotClause extends NodeLocation, Recoverable {
    type: "PivotClause";
    aggregate: Expression | null;
    forColumn: IdentifierNode | null;
    inColumns: IdentifierNode[];
    sourceAlias?: string;
}

export interface UnpivotClause extends NodeLocation, Recoverable {
    type: "UnpivotClause";
    valueColumn: IdentifierNode | null;
    forColumn: IdentifierNode | null;
    inColumns: IdentifierNode[];
    sourceAlias?: string;
}

export interface OpenJsonColumnDefinition extends NodeLocation, Recoverable {
    name: string;
    dataType: string;
    path?: string;
    asJson?: boolean;
}

export interface CaseBranch {
    when: Expression | null;
    then: Expression | null;
}

export interface CaseExpression extends NodeLocation, Recoverable {
    type: "CaseExpression";
    input?: Expression;
    branches: CaseBranch[];
    elseBranch?: Expression;
}

export interface InExpression extends NodeLocation, Recoverable {
    type: "InExpression";
    left: Expression;
    list?: Expression[];
    subquery?: QueryStatement;
    isNot: boolean;
}

export interface BetweenExpression extends NodeLocation {
    type: "BetweenExpression";
    left: Expression;
    lowerBound: Expression;
    upperBound: Expression;
    isNot: boolean;
}

export interface GroupingExpression extends NodeLocation, Recoverable {
    type: "GroupingExpression";
    expression: Expression | null;
}

export interface SubqueryExpression extends NodeLocation {
    type: "SubqueryExpression";
    query: QueryStatement;
}

export interface ValuesTableExpression extends NodeLocation, Recoverable {
    type: "ValuesTableExpression";
    rows: Expression[][];
}

export interface MemberExpression extends NodeLocation {
    type: "MemberExpression";
    object: Expression;
    property: string;
    name: string;
}

export interface WildcardExpression extends NodeLocation {
    type: "WildcardExpression";
    tablePrefix?: IdentifierNode;
}

export interface BuiltInArgumentNode extends NodeLocation {
    type: "BuiltInArgument";
    value: string;
}

// ===============================
// Window / OVER
// ===============================

export interface WindowDefinition extends NodeLocation, Recoverable {
    type: "WindowDefinition";
    partitionBy?: Expression[];
    orderBy?: OrderByNode[];
    frame?: FrameClause | null;
}

export interface OverExpression extends NodeLocation {
    type: "OverExpression";
    expression: Expression;
    window: WindowDefinition;
}

// ===============================
// Query & Statements
// ===============================

export type QueryStatement = SelectNode | SetOperatorNode;

export type Statement = (
    | QueryStatement
    | InsertNode
    | UpdateNode
    | UpdateStatisticsNode
    | DeleteNode
    | MergeNode
    | DeclareNode
    | SetNode
    | CreateNode
    | DropNode
    | IfNode
    | BlockNode
    | WithNode
    | PrintNode
    | ErrorNode
    | ReturnNode
    | RaiseErrorNode
    | ExecuteNode
    | UseNode
    | WhileNode
    | TryCatchNode
    | ThrowNode
    | BreakNode
    | ContinueNode
    | GotoNode
    | LabelNode
    | WaitForNode
    | DeclareCursorNode
    | OpenCursorNode
    | FetchCursorNode
    | CloseCursorNode
    | DeallocateCursorNode
    | CreateIndexNode
    | PermissionNode
    | TransactionNode
    | AlterDatabaseNode
    | AlterRoleNode
    | AlterTableNode
    | AlterIndexNode
    | BatchSeparatorNode
    | TruncateNode
) &
    NodeLocation;

export interface BatchSeparatorNode extends NodeLocation {
    type: "BatchSeparatorStatement";
    count?: number;
}

// ===============================
// SELECT
// ===============================

export interface SelectNode extends NodeLocation, Recoverable {
    type: "SelectStatement";
    distinct: boolean;
    top?: TopClause;
    columns: ColumnNode[];
    into?: IdentifierNode;
    from?: TableReference[];
    where?: Expression;
    groupBy?: Expression[];
    having?: Expression;
    orderBy?: OrderByNode[];

    offset?: Expression;
    fetch?: Expression;
    fetchApproximate?: boolean;
    forClause?: ForClause;
    optionClause?: OptionClause;
}

// ===============================
// Set Operators
// ===============================

export interface SetOperatorNode extends NodeLocation, Recoverable {
    type: "SetOperator";
    operator: "UNION" | "UNION ALL" | "EXCEPT" | "INTERSECT";
    left: QueryStatement;
    right: QueryStatement;
}

// ===============================
// INSERT / UPDATE / DELETE
// ===============================

export interface InsertNode extends NodeLocation, Recoverable {
    type: "InsertStatement";
    table: Expression | null;
    columns?: string[];
    columnNodes?: IdentifierNode[];
    output?: OutputClauseNode;
    values?: Expression[][];
    selectQuery?: QueryStatement;
}

export interface UpdateAssignment extends NodeLocation {
    type: "UpdateAssignment";
    column: string;
    columnNode: IdentifierNode | null;
    /**
     * Whether the assignment target is a table column (`SET Col = ...`) or
     * a local variable (`SET @x = ...`) — a single SET list can legally mix
     * both. Undefined when the target couldn't be determined at all (parse
     * error before a target name was read).
     */
    targetKind?: "column" | "variable";
    value: Expression | null;
}

export interface UpdateNode extends NodeLocation, Recoverable {
    type: "UpdateStatement";
    top?: TopClause;
    target: Expression | null;
    targetHints?: string[];
    assignments?: UpdateAssignment[];
    output?: OutputClauseNode;
    from?: TableReference[];
    where?: Expression;
    optionClause?: OptionClause;
}

export interface StatisticsOptionNode extends NodeLocation {
    type: "StatisticsOption";
    name: string;
    value?: string;
}

export interface UpdateStatisticsNode extends NodeLocation, Recoverable {
    type: "UpdateStatisticsStatement";
    table: IdentifierNode | null;
    statistics?: string | null;
    options?: StatisticsOptionNode[];
}

export interface DeleteNode extends NodeLocation, Recoverable {
    type: "DeleteStatement";
    top?: TopClause;
    target: Expression | null;
    output?: OutputClauseNode;
    from?: TableReference[];
    where?: Expression;
    optionClause?: OptionClause;
}

// ===============================
// MERGE
// ===============================

export type MergeMatchType =
    | "MATCHED"
    | "NOT MATCHED"
    | "NOT MATCHED BY SOURCE"
    | "NOT MATCHED BY TARGET";

export interface MergeInsertAction extends NodeLocation, Recoverable {
    type: "MergeInsertAction";
    columns?: string[] | null;
    columnNodes?: IdentifierNode[] | null;
    values?: Expression[] | null;
    selectQuery?: QueryStatement | null;
}

export interface MergeUpdateAction extends NodeLocation, Recoverable {
    type: "MergeUpdateAction";
    assignments: UpdateAssignment[] | null;
}

export interface MergeDeleteAction extends NodeLocation {
    type: "MergeDeleteAction";
}

export type MergeAction = MergeInsertAction | MergeUpdateAction | MergeDeleteAction;

export interface MergeWhenClause extends NodeLocation, Recoverable {
    type: "MergeWhenClause";
    condition: MergeMatchType;
    predicate?: Expression | null;
    action: MergeAction;
}

export interface MergeNode extends NodeLocation, Recoverable {
    type: "MergeStatement";
    top?: TopClause | null;
    target: Expression | null;
    targetAlias?: string;
    using: TableReference | null;
    on: Expression | null;
    whenClauses: MergeWhenClause[];
    output?: OutputClauseNode;
    optionClause?: OptionClause | null;
}

// ===============================
// DECLARE / SET
// ===============================

export interface VariableDeclaration extends NodeLocation {
    name: string;
    dataType: string;
    columns?: ColumnDefinition[] | null;
    constraints?: ConstraintNode[];
    initialValue?: Expression;
}

export interface DeclareNode extends NodeLocation, Recoverable {
    type: "DeclareStatement";
    variables: VariableDeclaration[];
}

export interface SetNode extends NodeLocation, Recoverable {
    type: "SetStatement";
    variable: string;
    variableStart: number;
    variableEnd: number;
    value: Expression | null;
    /** Set when this is a cursor-variable assignment: SET @c = CURSOR FOR <query> */
    cursorQuery?: QueryStatement;
}

// ===============================
// CONTROL FLOW
// ===============================

export interface IfNode extends NodeLocation, Recoverable {
    type: "IfStatement";
    condition: Expression;
    thenBranch: Statement | Statement[];
    elseBranch?: Statement | Statement[];
}

export interface BlockNode extends NodeLocation, Recoverable {
    type: "BlockStatement";
    body: Statement[];
}

// ===============================
// CREATE / DDL
// ===============================

export interface ColumnDefinition extends NodeLocation {
    name: string;
    dataType: string;
    computedExpression?: Expression | null;
    persisted?: boolean;
    constraints?: ConstraintNode[];
}

export interface ParameterDefinition extends NodeLocation {
    name: string;
    dataType: string;
    defaultValue?: Expression | null;
    isOutput?: boolean;
    isReadOnly?: boolean;
    isVarying?: boolean;
}

export interface CreateNode extends NodeLocation, Recoverable {
    type: "CreateStatement";
    objectType:
        | "TABLE"
        | "VIEW"
        | "PROCEDURE"
        | "FUNCTION"
        | "TYPE"
        | "TRIGGER"
        | "SCHEMA"
        | "SEQUENCE"
        | "SYNONYM"
        | "PARTITION_FUNCTION"
        | "PARTITION_SCHEME"
        | "LOGIN"
        | "USER"
        | "DATABASE";
    /** Set when the CREATE target is not modeled; the statement carries no name or body. */
    unsupportedObjectType?: string;
    orAlter: boolean;
    name: string;
    nameNode: IdentifierNode;
    columns?: ColumnDefinition[];
    constraints?: ConstraintNode[];
    indexes?: TableIndexNode[];
    parameters?: ParameterDefinition[];
    returnVariable?: string;
    returnType?: string;
    returnColumns?: ColumnDefinition[];
    body?: Statement | Statement[];
    isTableType?: boolean;
    baseType?: string;
    isClrType?: boolean;
    externalName?: string;
    nullable?: boolean;
    storage?: StorageTargetNode;
    textImageOn?: StorageTargetNode;
    partitionRange?: "LEFT" | "RIGHT";
    partitionInputType?: string;
    boundaryValues?: Expression[];
    partitionFunction?: IdentifierNode;
    filegroups?: IdentifierNode[];
    allTo?: boolean;
}

// ===============================
// DROP
// ===============================

export interface DropNode extends NodeLocation, Recoverable {
    type: "DropStatement";
    ifExists?: boolean;
    objectType:
        | "TABLE"
        | "VIEW"
        | "PROCEDURE"
        | "FUNCTION"
        | "INDEX"
        | "TRIGGER"
        | "TYPE"
        | "SCHEMA"
        | "SEQUENCE"
        | "SYNONYM"
        | "DATABASE"
        | "USER"
        | "ROLE"
        | "LOGIN"
        | "STATISTICS";
    target: IdentifierNode | null;
    /** All targets in a comma-separated DROP list; `target` remains the first for compatibility. */
    targets?: IdentifierNode[];
    /** The table qualified by `DROP INDEX ... ON <table>`. */
    onTable?: IdentifierNode | null;
}

// ===============================
// WITH / CTE
// ===============================

export interface CTENode extends NodeLocation, Recoverable {
    name: string;
    columns?: string[];
    query: QueryStatement;
}

export interface XmlNamespaceNode extends NodeLocation, Recoverable {
    uri: string;
    prefix?: string;
    isDefault?: boolean;
}

export interface WithNode extends NodeLocation, Recoverable {
    type: "WithStatement";
    ctes: CTENode[];
    xmlNamespaces?: XmlNamespaceNode[];
    body: Statement;
}

// ===============================
// PRINT
// ===============================

export interface PrintNode extends NodeLocation, Recoverable {
    type: "PrintStatement";
    value: Expression | null;
}

// ===============================
// ERROR
// ===============================

export interface ErrorNode extends NodeLocation {
    type: "ErrorStatement";
    message: string;
}

// ===============================
// TABLE / JOIN / ORDER
// ===============================

export interface TableReference extends NodeLocation, Recoverable {
    type: "TableReference";
    table: Expression | TableReference | null;
    alias?: string;
    aliasColumns?: string[];
    schema?: string;
    forSystemTime?: TemporalTableClause;
    hints?: string[];
    pivot?: PivotClause | null;
    unpivot?: UnpivotClause | null;
    joins: JoinNode[];
}

export type JoinType =
    | "INNER JOIN"
    | "LEFT OUTER JOIN"
    | "RIGHT OUTER JOIN"
    | "FULL OUTER JOIN"
    | "CROSS JOIN"
    | "CROSS APPLY"
    | "OUTER APPLY";

export type JoinHint = "HASH" | "MERGE" | "LOOP";

export interface JoinNode extends NodeLocation, Recoverable {
    type: JoinType;
    rawType: string;
    joinHint?: JoinHint;
    table: Expression | TableReference | null;
    on: Expression | null;
    hints?: string[];
    alias?: string;
    aliasColumns?: string[];
    forSystemTime?: TemporalTableClause;
}

/** SQL Server system-versioned temporal-table query qualifier. */
export type TemporalTableClause =
    | { kind: "AS_OF"; asOf: Expression; start: number; end: number }
    | { kind: "FROM_TO"; from: Expression; to: Expression; start: number; end: number }
    | {
          kind: "BETWEEN";
          from: Expression;
          to: Expression;
          start: number;
          end: number;
      }
    | {
          kind: "CONTAINED_IN";
          from: Expression;
          to: Expression;
          start: number;
          end: number;
      }
    | { kind: "ALL"; start: number; end: number };

export interface ColumnNode extends NodeLocation {
    type: "Column";
    expression: Expression;
    sourceName?: string;
    alias?: string;
    outputName: string;
    wildcard?: boolean;
}

export interface OrderByNode extends NodeLocation {
    expression: Expression;
    direction: "ASC" | "DESC";
}

// ===============================
// OUTPUT
// ===============================

export interface OutputColumnNode extends NodeLocation {
    type: "OutputColumn";
    sourceTable: "INSERTED" | "DELETED" | null;
    sourceLocation?: NodeLocation;
    column: ColumnNode;
}

export interface OutputClauseNode extends NodeLocation, Recoverable {
    type: "OutputClause";
    columns: OutputColumnNode[];
    intoTable?: Expression;
    intoColumns?: string[];
    intoColumnNodes?: IdentifierNode[];
}

export interface ReturnNode extends NodeLocation, Recoverable {
    type: "ReturnStatement";
    value?: Expression | null;
    query?: Statement | null;
}

export interface RaiseErrorNode extends NodeLocation, Recoverable {
    type: "RaiseErrorStatement";
    args: Expression[];
    options?: string[];
}

export type ExecArgument = {
    name?: string;
    value: Expression | null;
    isOutput?: boolean;
};

export interface ExecuteNode extends NodeLocation, Recoverable {
    type: "ExecuteStatement";
    target: Expression | null;
    args: ExecArgument[];
}

export interface UseNode extends NodeLocation, Recoverable {
    type: "UseStatement";
    database: Expression | null;
}

export interface PermissionNode extends NodeLocation, Recoverable {
    type: "PermissionStatement";
    action: "GRANT" | "DENY";
    permissions: string[];
    securableClass?: string;
    securable?: IdentifierNode | null;
    principal?: IdentifierNode | null;
    asPrincipal?: IdentifierNode | null;
}

export interface AlterDatabaseNode extends NodeLocation, Recoverable {
    type: "AlterDatabaseStatement";
    database: IdentifierNode | null;
    actionTokens: string[];
}

export interface CastExpression extends NodeLocation, Recoverable {
    type: "CastExpression";
    kind: "CAST" | "TRY_CAST" | "CONVERT" | "PARSE" | "TRY_PARSE";
    expression: Expression;
    dataType: string;
    style?: Expression | null;
    culture?: Expression | null;
}

export interface ConstraintNode extends NodeLocation, Recoverable {
    name?: string;

    kind:
        | "PRIMARY KEY"
        | "FOREIGN KEY"
        | "UNIQUE"
        | "CHECK"
        | "DEFAULT"
        | "NOT NULL"
        | "NOT FOR REPLICATION"
        | "NULL"
        | "IDENTITY";

    columns?: string[];
    expression?: Expression | null;

    referencesTable?: string;
    referencesColumns?: string[];
    onDelete?: "CASCADE" | "SET NULL" | "SET DEFAULT" | "NO ACTION";
    onUpdate?: "CASCADE" | "SET NULL" | "SET DEFAULT" | "NO ACTION";
    storage?: StorageTargetNode;

    seed?: number;
    increment?: number;
    missingLeadingComma?: boolean;
}

export interface StorageTargetNode extends NodeLocation, Recoverable {
    type: "StorageTarget";
    kind: "FILEGROUP" | "PARTITION_SCHEME" | "DEFAULT";
    name?: string;
    nameNode?: IdentifierNode;
    partitionColumn?: IdentifierNode;
}

export interface WhileNode extends NodeLocation, Recoverable {
    type: "WhileStatement";
    condition: Expression | null;
    body: Statement | null;
}

// Index column with optional direction
export interface IndexColumnNode extends NodeLocation {
    type: "IndexColumn";
    name: string;
    nameNode: IdentifierNode;
    direction: "ASC" | "DESC";
}

// WITH option: ONLINE = ON, FILLFACTOR = 80, etc.
export interface IndexOptionNode extends NodeLocation {
    type: "IndexOption";
    name: string;
    value: string; // raw string — ON/OFF/number
}

// Index creation statement
export interface CreateIndexNode extends NodeLocation, Recoverable {
    type: "CreateIndexStatement";
    indexKind: "BTREE" | "JSON" | "VECTOR";
    unique: boolean;
    clustered: "CLUSTERED" | "NONCLUSTERED" | null;
    name: string;
    nameNode: IdentifierNode;
    table: IdentifierNode;
    columns: IndexColumnNode[];
    include?: IdentifierNode[];
    where?: Expression;
    options?: IndexOptionNode[];
    storage?: StorageTargetNode;
    jsonPaths?: Expression[];
}

export interface TableIndexNode extends NodeLocation, Recoverable {
    type: "TableIndexDefinition";
    unique: boolean;
    clustered: "CLUSTERED" | "NONCLUSTERED" | null;
    name: string;
    nameNode: IdentifierNode | null;
    columns: IndexColumnNode[];
}

// ===============================
// TRY / CATCH
// ===============================

export interface TryCatchNode extends NodeLocation, Recoverable {
    type: "TryCatchStatement";
    tryBlock: BlockNode;
    catchBlock: BlockNode;
}

// ===============================
// THROW
// ===============================

export interface ThrowNode extends NodeLocation, Recoverable {
    type: "ThrowStatement";
    // Arguments are optional — bare THROW re-throws inside a CATCH
    errorNumber?: Expression | null;
    message?: Expression | null;
    state?: Expression | null;
}

// ===============================
// BREAK / CONTINUE
// ===============================

export interface BreakNode extends NodeLocation {
    type: "BreakStatement";
}

export interface ContinueNode extends NodeLocation {
    type: "ContinueStatement";
}

export interface GotoNode extends NodeLocation, Recoverable {
    type: "GotoStatement";
    label: string | null;
}

export interface LabelNode extends NodeLocation {
    type: "LabelStatement";
    name: string;
}

export interface WaitForNode extends NodeLocation, Recoverable {
    type: "WaitForStatement";
    kind: "TIME" | "DELAY" | null;
    value: Expression | null;
}

export interface DeclareCursorNode extends NodeLocation, Recoverable {
    type: "DeclareCursorStatement";
    name: string | null;
    options?: string[];
    query: QueryStatement | null;
}

export interface OpenCursorNode extends NodeLocation, Recoverable {
    type: "OpenCursorStatement";
    name: string | null;
}

export interface FetchCursorNode extends NodeLocation, Recoverable {
    type: "FetchCursorStatement";
    direction?: string;
    offset?: Expression | null;
    name: string | null;
    into?: string[];
}

export interface CloseCursorNode extends NodeLocation, Recoverable {
    type: "CloseCursorStatement";
    name: string | null;
}

export interface DeallocateCursorNode extends NodeLocation, Recoverable {
    type: "DeallocateCursorStatement";
    name: string | null;
}

export type ForJsonDirective = "AUTO" | "PATH";

export type ForXmlDirective = "AUTO" | "PATH" | "RAW" | "EXPLICIT";

export type ForJsonOption =
    | { kind: "ROOT"; value?: string }
    | { kind: "INCLUDE_NULL_VALUES" }
    | { kind: "WITHOUT_ARRAY_WRAPPER" }
    | { kind: "UNKNOWN"; value: string };

export type ForXmlOption =
    | { kind: "TYPE" }
    | { kind: "ELEMENTS"; xsinil?: boolean }
    | { kind: "ROOT"; value?: string }
    | { kind: "BINARY_BASE64" }
    | { kind: "XMLSCHEMA" }
    | { kind: "XMLDATA" }
    | { kind: "UNKNOWN"; value: string };

export type ForClause =
    | {
          mode: "JSON";
          directive: ForJsonDirective;
          options?: ForJsonOption[];
      }
    | {
          mode: "XML";
          directive: ForXmlDirective;
          argument?: string;
          options?: ForXmlOption[];
      };

export type QueryHint =
    | { kind: "RECOMPILE"; raw: string }
    | { kind: "HASH_JOIN"; raw: string }
    | { kind: "MERGE_JOIN"; raw: string }
    | { kind: "LOOP_JOIN"; raw: string }
    | { kind: "HASH_GROUP"; raw: string }
    | { kind: "ORDER_GROUP"; raw: string }
    | { kind: "MERGE_UNION"; raw: string }
    | { kind: "CONCAT_UNION"; raw: string }
    | { kind: "FORCE_ORDER"; raw: string }
    | { kind: "KEEP_PLAN"; raw: string }
    | { kind: "KEEPFIXED_PLAN"; raw: string }
    | { kind: "ROBUST_PLAN"; raw: string }
    | { kind: "MAXDOP"; raw: string; value: number }
    | { kind: "FAST"; raw: string; value: number }
    | { kind: "MAXRECURSION"; raw: string; value: number }
    | { kind: "PARAMETERIZATION"; raw: string; value: "SIMPLE" | "FORCED" }
    | { kind: "OPTIMIZE_FOR"; raw: string; value: string }
    | { kind: "USE_HINT"; raw: string; value: string }
    | { kind: "UNKNOWN"; raw: string };

export interface OptionClause extends NodeLocation, Recoverable {
    type: "OptionClause";
    hints: QueryHint[];
}

// ===============================
// TRANSACTIONS
// ===============================

export type TransactionAction = "BEGIN" | "COMMIT" | "ROLLBACK" | "SAVE";

export interface TransactionNode extends NodeLocation, Recoverable {
    type: "TransactionStatement";
    action: TransactionAction;
    name?: string; // optional for BEGIN/COMMIT/ROLLBACK, required for SAVE
    distributed?: boolean; // BEGIN DISTRIBUTED TRANSACTION
}

export interface TopClause extends NodeLocation, Recoverable {
    type: "TopClause";
    quantity: Expression | null;
    percent: boolean;
    withTies: boolean;
    approximate?: boolean;
}

export type FrameUnit = "ROWS" | "RANGE";

export type FrameBoundary =
    | { type: "UNBOUNDED_PRECEDING" }
    | { type: "UNBOUNDED_FOLLOWING" }
    | { type: "CURRENT_ROW" }
    | { type: "PRECEDING"; value: Expression }
    | { type: "FOLLOWING"; value: Expression };

export interface FrameClause extends NodeLocation, Recoverable {
    type: "FrameClause";
    unit: FrameUnit;
    start: number;
    end: number;
    from: FrameBoundary | null;
    to?: FrameBoundary; // present when BETWEEN ... AND ... form
}

// ALTER TABLE
export type AlterTableAction =
    | { kind: "ADD_COLUMN"; column: ColumnDefinition }
    | { kind: "DROP_COLUMN"; name: string; ifExists?: boolean }
    | { kind: "ADD_CONSTRAINT"; constraint: ConstraintNode; enforcement?: "CHECK" | "NOCHECK" }
    | { kind: "DROP_CONSTRAINT"; name: string; ifExists?: boolean }
    | { kind: "ALTER_COLUMN"; column: ColumnDefinition };

export interface AlterTableNode extends NodeLocation, Recoverable {
    type: "AlterTableStatement";
    table: IdentifierNode;
    action: AlterTableAction | null;
}

export type AlterRoleAction =
    | { kind: "ADD_MEMBER"; member: IdentifierNode | null }
    | { kind: "DROP_MEMBER"; member: IdentifierNode | null };

export interface AlterRoleNode extends NodeLocation, Recoverable {
    type: "AlterRoleStatement";
    role: IdentifierNode | null;
    action: AlterRoleAction | null;
}

export type AlterIndexAction =
    | {
          kind: "REBUILD";
          partition?: Expression | null;
          options?: IndexOptionNode[];
      }
    | {
          kind: "REORGANIZE";
          partition?: Expression | null;
      }
    | {
          kind: "DISABLE";
      }
    | {
          kind: "SET";
          options?: IndexOptionNode[];
      }
    | {
          kind: "UNKNOWN";
          raw: string;
      };

export interface AlterIndexNode extends NodeLocation, Recoverable {
    type: "AlterIndexStatement";
    indexName: string;
    indexNameNode: IdentifierNode | null;
    table: IdentifierNode | null;
    action: AlterIndexAction | null;
}

// TRUNCATE
export interface TruncateNode extends NodeLocation, Recoverable {
    type: "TruncateStatement";
    table: IdentifierNode | null;
}

export interface ExistsExpression extends NodeLocation, Recoverable {
    type: "ExistsExpression";
    query: QueryStatement;
}
