/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesigner } from "../../../sharedInterfaces/schemaDesigner";
import { locConstants } from "../../common/locConstants";
import {
  Connection,
  ConnectionLineType,
  Edge,
  MarkerType,
  Node,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import { v4 as uuidv4 } from "uuid";

export const namingUtils = {
  getNextColumnName: (columns: SchemaDesigner.Column[]): string => {
    let index = 1;
    while (columns.some((c) => c.name === `column_${index}`)) index++;
    return `column_${index}`;
  },

  getNextForeignKeyName: (
    foreignKeys: SchemaDesigner.ForeignKey[],
    tables: SchemaDesigner.Table[],
  ): string => {
    // Collect all existing FK names across all tables
    const existingFkNames = new Set<string>();

    for (const table of tables) {
      for (const fk of table.foreignKeys) {
        existingFkNames.add(fk.name);
      }
    }

    for (const fk of foreignKeys) {
      existingFkNames.add(fk.name);
    }

    let index = 1;
    // Find the next available FK name
    while (existingFkNames.has(`FK_${index}`)) {
      index++;
    }
    return `FK_${index}`;
  },

  getNextTableName: (tables: SchemaDesigner.Table[]): string => {
    let index = 1;
    while (tables.some((t) => t.name === `table_${index}`)) index++;
    return `table_${index}`;
  },
};

export const tableUtils = {
  getAllTables: (
    schema: SchemaDesigner.Schema,
    current?: SchemaDesigner.Table,
  ): SchemaDesigner.Table[] => {
    return schema.tables
      .filter(
        (t) =>
          !current || t.schema !== current.schema || t.name !== current.name,
      )
      .sort();
  },

  getTableFromDisplayName: (
    schema: SchemaDesigner.Schema,
    displayName: string,
  ): SchemaDesigner.Table => {
    return schema.tables.find((t) => `${t.schema}.${t.name}` === displayName)!;
  },

  tableNameValidationError: (
    schema: SchemaDesigner.Schema,
    table: SchemaDesigner.Table,
  ): string | undefined => {
    const conflict = schema.tables.find(
      (t) =>
        t.name.toLowerCase() === table.name.toLowerCase() &&
        t.schema.toLowerCase() === table.schema.toLowerCase() &&
        t.id !== table.id,
    );

    if (conflict)
      return locConstants.schemaDesigner.tableNameRepeatedError(table.name);
    if (!table.name) return locConstants.schemaDesigner.tableNameEmptyError;
    return undefined;
  },

  createNewTable: (
    schema: SchemaDesigner.Schema,
    schemaNames: string[],
  ): SchemaDesigner.Table => {
    const name = namingUtils.getNextTableName(schema.tables);
    return {
      name,
      schema: schemaNames[0],
      columns: [
        {
          name: "Id",
          dataType: "int",
          maxLength: "",
          precision: 0,
          scale: 0,
          isNullable: false,
          isPrimaryKey: true,
          id: uuidv4(),
          isIdentity: true,
          identitySeed: 1,
          identityIncrement: 1,
          defaultValue: "",
          isComputed: false,
          computedFormula: "",
          computedPersisted: false,
        },
      ],
      foreignKeys: [],
      id: uuidv4(),
    };
  },
};

export interface AdvancedColumnOption {
  label: string;
  type: "input" | "input-number" | "checkbox" | "textarea";
  value: string | number | boolean;
  hint?: string;
  columnProperty: keyof SchemaDesigner.Column;
  columnModifier: (
    column: SchemaDesigner.Column,
    value: string | number | boolean,
  ) => SchemaDesigner.Column;
}

export const columnUtils = {
  isColumnValid: (
    column: SchemaDesigner.Column,
    columns: SchemaDesigner.Column[],
  ): string | undefined => {
    const conflict = columns.find(
      (c) =>
        c.name.toLowerCase() === column.name.toLowerCase() &&
        c.id !== column.id &&
        c.dataType === column.dataType,
    );
    if (conflict)
      return locConstants.schemaDesigner.columnNameRepeatedError(column.name);
    if (!column.name) return locConstants.schemaDesigner.columnNameEmptyError;
    if (column.isPrimaryKey && column.isNullable)
      return locConstants.schemaDesigner.columnPKCannotBeNull(column.name);
    // Check if maxlength is a valid number or MAX
    if (columnUtils.isLengthBasedType(column.dataType)) {
      if (!column.maxLength) {
        return locConstants.schemaDesigner.columnMaxLengthEmptyError;
      }
      if (column.maxLength && column.maxLength !== "MAX") {
        const maxLength = parseInt(column.maxLength);
        if (isNaN(maxLength) || maxLength <= 0) {
          return locConstants.schemaDesigner.columnMaxLengthInvalid(
            column.maxLength,
          );
        }
      }
    }
  },
  isLengthBasedType: (type: string): boolean => {
    return [
      "char",
      "varchar",
      "nchar",
      "nvarchar",
      "binary",
      "varbinary",
      "vector",
    ].includes(type);
  },
  isTimeBasedWithScale: (type: string): boolean => {
    return ["datetime2", "datetimeoffset", "time"].includes(type);
  },
  isPrecisionBasedType: (type: string): boolean => {
    return ["decimal", "numeric"].includes(type);
  },
  isIdentityBasedType: (type: string, scale: number): boolean => {
    if (type === "decimal" || type === "numeric") {
      return scale === 0;
    }
    return ["int", "bigint", "smallint", "tinyint"].includes(type);
  },
  getDefaultLength: (type: string): string => {
    switch (type) {
      case "char":
      case "nchar":
      case "binary":
      case "vector":
        return "1";
      case "varchar":
      case "nvarchar":
      case "varbinary":
        return "50";
      default:
        return "0";
    }
  },

  getDefaultPrecision: (type: string): number => {
    switch (type) {
      case "decimal":
      case "numeric":
        return 18;
      default:
        return 0;
    }
  },

  getDefaultScale: (type: string): number => {
    switch (type) {
      case "decimal":
      case "numeric":
        return 0;
      default:
        return 0;
    }
  },

  fillColumnDefaults: (
    column: SchemaDesigner.Column,
  ): SchemaDesigner.Column => {
    if (columnUtils.isLengthBasedType(column.dataType))
      column.maxLength = columnUtils.getDefaultLength(column.dataType);
    else column.maxLength = "";

    if (columnUtils.isPrecisionBasedType(column.dataType)) {
      column.precision = columnUtils.getDefaultPrecision(column.dataType);
      column.scale = columnUtils.getDefaultScale(column.dataType);
    } else {
      column.precision = 0;
      column.scale = 0;
    }

    if (columnUtils.isTimeBasedWithScale(column.dataType)) {
      column.scale = columnUtils.getDefaultScale(column.dataType);
    } else {
      column.scale = 0;
    }

    return column;
  },

  getAdvancedOptions: (
    column: SchemaDesigner.Column,
  ): AdvancedColumnOption[] => {
    const options: AdvancedColumnOption[] = [];
    // Adding allow null option
    if (!column.isPrimaryKey) {
      options.push({
        label: locConstants.schemaDesigner.allowNull,
        type: "checkbox",
        value: false,
        columnProperty: "isNullable",
        columnModifier: (column, value) => {
          column.isNullable = value as boolean;
          return column;
        },
      });
    }
    if (!column.isComputed) {
      if (
        columnUtils.isIdentityBasedType(column.dataType, column.scale) &&
        (!column.isNullable || column.isPrimaryKey)
      ) {
        // Push is identity option
        options.push({
          label: locConstants.schemaDesigner.isIdentity,
          value: "isIdentity",
          type: "checkbox",
          columnProperty: "isIdentity",
          columnModifier: (column, value) => {
            column.isIdentity = value as boolean;
            column.identitySeed = value ? 1 : 0;
            column.identityIncrement = value ? 1 : 0;
            return column;
          },
        });
      }

      if (columnUtils.isLengthBasedType(column.dataType)) {
        options.push({
          label: locConstants.schemaDesigner.maxLength,
          value: "",
          type: "input",
          columnProperty: "maxLength",
          columnModifier: (column, value) => {
            column.maxLength = value as string;
            if (!column.maxLength) {
              column.maxLength = "0";
            }
            return column;
          },
        });
      }

      if (columnUtils.isPrecisionBasedType(column.dataType)) {
        options.push({
          label: locConstants.schemaDesigner.precision,
          value: "",
          type: "input-number",
          columnProperty: "precision",
          columnModifier: (column, value) => {
            column.precision = value as number;
            return column;
          },
        });
      }

      if (
        columnUtils.isTimeBasedWithScale(column.dataType) ||
        columnUtils.isPrecisionBasedType(column.dataType)
      ) {
        options.push({
          label: locConstants.schemaDesigner.scale,
          value: "",
          type: "input-number",
          columnProperty: "scale",
          columnModifier: (column, value) => {
            column.scale = value as number;
            return column;
          },
        });
      }

      options.push({
        label: locConstants.schemaDesigner.defaultValue,
        value: "",
        type: "textarea",
        columnProperty: "defaultValue",
        columnModifier: (column, value) => {
          column.defaultValue = value as string;
          return column;
        },
      });
    }

    options.push({
      label: locConstants.schemaDesigner.isComputed,
      value: false,
      type: "checkbox",
      columnProperty: "isComputed",
      columnModifier: (column, value) => {
        column.isComputed = value as boolean;
        column.isPrimaryKey = false;
        column.isIdentity = false;
        column.identitySeed = 0;
        column.identityIncrement = 0;
        column.isNullable = true;
        column.computedFormula = value ? "1" : "";
        column.computedPersisted = false;
        column.dataType = value ? "int" : column.dataType;
        return column;
      },
    });

    if (column.isComputed) {
      options.push({
        label: locConstants.schemaDesigner.computedFormula,
        value: "",
        type: "textarea",
        columnProperty: "computedFormula",
        columnModifier: (column, value) => {
          column.computedFormula = value as string;
          return column;
        },
      });
      options.push({
        label: locConstants.schemaDesigner.isPersisted,
        value: false,
        type: "checkbox",
        columnProperty: "computedPersisted",
        columnModifier: (column, value) => {
          column.computedPersisted = value as boolean;
          return column;
        },
      });
    }

    return options;
  },
};

// Foreign key validation
export interface ForeignKeyValidationResult {
  isValid: boolean;
  errorMessage?: string;
}

export const foreignKeyUtils = {
  areDataTypesCompatible: (
    col: SchemaDesigner.Column,
    refCol: SchemaDesigner.Column,
  ): ForeignKeyValidationResult => {
    if (col.dataType !== refCol.dataType) {
      return {
        isValid: false,
        errorMessage: locConstants.schemaDesigner.incompatibleDataTypes(
          col.dataType,
          col.name,
          refCol.dataType,
          refCol.name,
        ),
      };
    }

    if (
      columnUtils.isLengthBasedType(col.dataType) &&
      col.maxLength !== refCol.maxLength
    ) {
      return {
        isValid: false,
        errorMessage: locConstants.schemaDesigner.incompatibleLength(
          col.name,
          refCol.name,
          col.maxLength,
          refCol.maxLength,
        ),
      };
    }

    if (
      columnUtils.isPrecisionBasedType(col.dataType) &&
      (col.precision !== refCol.precision || col.scale !== refCol.scale)
    ) {
      return {
        isValid: false,
        errorMessage: locConstants.schemaDesigner.incompatiblePrecisionOrScale(
          col.name,
          refCol.name,
        ),
      };
    }

    if (
      columnUtils.isTimeBasedWithScale(col.dataType) &&
      col.scale !== refCol.scale
    ) {
      return {
        isValid: false,
        errorMessage: locConstants.schemaDesigner.incompatibleScale(
          col.name,
          refCol.name,
        ),
      };
    }

    return { isValid: true };
  },

  isCyclicForeignKey: (
    tables: SchemaDesigner.Table[],
    current: SchemaDesigner.Table | undefined,
    target: SchemaDesigner.Table | undefined,
    visited = new Set<string>(),
  ): boolean => {
    if (!current || !target) return false;

    // Allow direct self-references (table referencing itself)
    // This handles the case where a table wants to reference itself (e.g., Employee.ManagerID → Employee.EmployeeID)
    if (current.id === target.id && visited.size === 0) {
      return false;
    }

    if (visited.has(current.id)) return true;

    visited.add(current.id);
    for (const fk of current.foreignKeys) {
      const next = tables.find(
        (t) =>
          t.name === fk.referencedTableName &&
          t.schema === fk.referencedSchemaName,
      );
      if (!next) continue;
      if (
        next.id === target.id ||
        foreignKeyUtils.isCyclicForeignKey(
          tables,
          next,
          target,
          new Set(visited),
        )
      )
        return true;
    }
    return false;
  },

  isForeignKeyValid: (
    tables: SchemaDesigner.Table[],
    table: SchemaDesigner.Table,
    fk: SchemaDesigner.ForeignKey,
  ): ForeignKeyValidationResult => {
    // Check if foreign table exists
    const refTable = tables.find(
      (t) =>
        t.name === fk.referencedTableName &&
        t.schema === fk.referencedSchemaName,
    );
    if (!refTable)
      return {
        isValid: false,
        errorMessage: locConstants.schemaDesigner.referencedTableNotFound(
          fk.referencedTableName,
        ),
      };

    const existingFks = table.foreignKeys.filter((f) => f.id !== fk.id);

    // Check if columns do not have other foreign keys
    const columnsSet = new Set();
    for (const fks of existingFks) {
      for (const col of fks.columns) {
        columnsSet.add(col);
      }
    }
    for (const cols of fk.columns) {
      if (columnsSet.has(cols)) {
        return {
          isValid: false,
          errorMessage:
            locConstants.schemaDesigner.duplicateForeignKeyColumns(cols),
        };
      }
      columnsSet.add(cols);
    }

    // Check if columns exist in the table
    for (let i = 0; i < fk.columns.length; i++) {
      const col = table.columns.find((c) => c.name === fk.columns[i]);
      const refCol = refTable.columns.find(
        (c) => c.name === fk.referencedColumns[i],
      );

      if (!col)
        return {
          isValid: false,
          errorMessage: locConstants.schemaDesigner.columnNotFound(
            fk.columns[i],
          ),
        };
      if (!refCol)
        return {
          isValid: false,
          errorMessage: locConstants.schemaDesigner.referencedColumnNotFound(
            fk.referencedColumns[i],
          ),
        };
      // Check if column mapping data types are compatible
      const typeCheck = foreignKeyUtils.areDataTypesCompatible(col, refCol);
      if (!typeCheck.isValid) return typeCheck;

      // Check if referenced column is primary key or unique
      if (!refCol.isPrimaryKey) {
        return {
          isValid: false,
          errorMessage: locConstants.schemaDesigner.referencedColumnNotPK(
            refCol.name,
          ),
        };
      }

      if (
        col.isIdentity &&
        (fk.onUpdateAction !== SchemaDesigner.OnAction.NO_ACTION ||
          fk.onDeleteAction !== SchemaDesigner.OnAction.NO_ACTION)
      ) {
        return {
          isValid: false,
          errorMessage: locConstants.schemaDesigner.identityColumnFKConstraint(
            col.name,
          ),
        };
      }
    }

    return { isValid: true };
  },

  getForeignKeyWarnings: (
    tables: SchemaDesigner.Table[],
    table: SchemaDesigner.Table,
    fk: SchemaDesigner.ForeignKey,
  ): ForeignKeyValidationResult => {
    // Check if foreign key name is empty
    let hasWarnings = false;
    let warningMessages: string[] = [];

    // Check if foreign table exists
    const refTable = tables.find(
      (t) =>
        t.name === fk.referencedTableName &&
        t.schema === fk.referencedSchemaName,
    );

    if (!refTable) {
      return {
        isValid: false,
        errorMessage: locConstants.schemaDesigner.referencedTableNotFound(
          fk.referencedTableName,
        ),
      };
    }

    if (!fk.name) {
      hasWarnings = true;
      warningMessages.push(
        locConstants.schemaDesigner.foreignKeyNameEmptyWarning,
      );
    }

    if (foreignKeyUtils.isCyclicForeignKey(tables, refTable, table)) {
      hasWarnings = true;
      warningMessages.push(
        locConstants.schemaDesigner.cyclicForeignKeyDetected(
          table.name,
          refTable.name,
        ),
      );
    }

    return {
      isValid: !hasWarnings,
      errorMessage: hasWarnings ? warningMessages.join(", ") : undefined,
    };
  },

  extractForeignKeysFromEdges: (
    edges: Edge<SchemaDesigner.ForeignKey>[],
    sourceTableId: string,
    schema: SchemaDesigner.Schema,
  ): SchemaDesigner.ForeignKey[] => {
    const filteredEdges = edges.filter((edge) => edge.source === sourceTableId);
    const edgesMap = new Map<string, SchemaDesigner.ForeignKey>();

    filteredEdges.forEach((edge) => {
      const sourceTable = schema.tables.find((t) => t.id === edge.source);
      const targetTable = schema.tables.find((t) => t.id === edge.target);

      if (!sourceTable || !targetTable || !edge.data) {
        return;
      }

      const foreignKey: SchemaDesigner.ForeignKey = {
        id: edge.data.id,
        columns: [...edge.data.columns],
        name: edge.data.name,
        onDeleteAction: edge.data.onDeleteAction,
        onUpdateAction: edge.data.onUpdateAction,
        referencedColumns: [...edge.data.referencedColumns],
        referencedSchemaName: edge.data.referencedSchemaName,
        referencedTableName: edge.data.referencedTableName,
      };

      if (edgesMap.has(edge.data.id)) {
        // If the edge already exists, append columns and referencedColumns
        const existingForeignKey = edgesMap.get(edge.data.id);
        if (existingForeignKey) {
          existingForeignKey.columns.push(...foreignKey.columns);
          existingForeignKey.referencedColumns.push(
            ...foreignKey.referencedColumns,
          );
        }
      } else {
        edgesMap.set(edge.data.id, foreignKey);
      }
    });

    return Array.from(edgesMap.values());
  },

  /**
   * Extract column name from a handle ID
   */
  extractColumnNameFromHandle: (handleId: string): string => {
    return handleId.replace("left-", "").replace("right-", "");
  },

  /**
   * Creates a foreign key object from connection data
   */
  createForeignKeyFromConnection: (
    sourceNode: Node<SchemaDesigner.Table>,
    targetNode: Node<SchemaDesigner.Table>,
    sourceColumnName: string,
    targetColumnName: string,
    existingFkId?: string,
    existingFkName?: string,
  ): SchemaDesigner.ForeignKey => {
    return {
      id: existingFkId || uuidv4(),
      name:
        existingFkName || `FK_${sourceNode.data.name}_${targetNode.data.name}`,
      columns: [sourceColumnName],
      referencedSchemaName: targetNode.data.schema,
      referencedTableName: targetNode.data.name,
      referencedColumns: [targetColumnName],
      onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
      onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
    };
  },

  /**
   * Validates a connection between nodes
   */
  validateConnection: (
    connection: Connection | Edge<SchemaDesigner.ForeignKey>,
    nodes: Node<SchemaDesigner.Table>[],
    edges: Edge<SchemaDesigner.ForeignKey>[],
  ): ForeignKeyValidationResult => {
    const sourceTable = nodes.find(
      (node) => node.id === connection.source,
    ) as Node<SchemaDesigner.Table>;
    const targetTable = nodes.find(
      (node) => node.id === connection.target,
    ) as Node<SchemaDesigner.Table>;

    if (!sourceTable || !targetTable) {
      return {
        isValid: false,
        errorMessage: "Source or target table not found",
      };
    }

    const sourceColumnName = connection.sourceHandle
      ? foreignKeyUtils.extractColumnNameFromHandle(connection.sourceHandle)
      : "";
    const targetColumnName = connection.targetHandle
      ? foreignKeyUtils.extractColumnNameFromHandle(connection.targetHandle)
      : "";

    if (!sourceColumnName || !targetColumnName) {
      return {
        isValid: false,
        errorMessage: "Source or target column not found",
      };
    }

    // Create a foreign key for validation
    const foreignKey = foreignKeyUtils.createForeignKeyFromConnection(
      sourceTable,
      targetTable,
      sourceColumnName,
      targetColumnName,
    );

    // Validate the foreign key relationship
    return foreignKeyUtils.isForeignKeyValid(
      flowUtils.extractSchemaModel(nodes, edges).tables,
      sourceTable.data,
      foreignKey,
    );
  },

  getOnActionOptions: (): {
    label: string;
    value: SchemaDesigner.OnAction;
  }[] => {
    return [
      {
        label: locConstants.schemaDesigner.cascade,
        value: SchemaDesigner.OnAction.CASCADE,
      },
      {
        label: locConstants.schemaDesigner.noAction,
        value: SchemaDesigner.OnAction.NO_ACTION,
      },
      {
        label: locConstants.schemaDesigner.setNull,
        value: SchemaDesigner.OnAction.SET_NULL,
      },
      {
        label: locConstants.schemaDesigner.setDefault,
        value: SchemaDesigner.OnAction.SET_DEFAULT,
      },
    ];
  },

  convertStringToOnAction: (action: string): SchemaDesigner.OnAction => {
    switch (action) {
      case locConstants.schemaDesigner.cascade:
        return SchemaDesigner.OnAction.CASCADE;
      case locConstants.schemaDesigner.noAction:
        return SchemaDesigner.OnAction.NO_ACTION;
      case locConstants.schemaDesigner.setNull:
        return SchemaDesigner.OnAction.SET_NULL;
      case locConstants.schemaDesigner.setDefault:
        return SchemaDesigner.OnAction.SET_DEFAULT;
      default:
        return SchemaDesigner.OnAction.NO_ACTION;
    }
  },

  convertOnActionToString: (action: SchemaDesigner.OnAction): string => {
    switch (action) {
      case SchemaDesigner.OnAction.CASCADE:
        return locConstants.schemaDesigner.cascade;
      case SchemaDesigner.OnAction.NO_ACTION:
        return locConstants.schemaDesigner.noAction;
      case SchemaDesigner.OnAction.SET_NULL:
        return locConstants.schemaDesigner.setNull;
      case SchemaDesigner.OnAction.SET_DEFAULT:
        return locConstants.schemaDesigner.setDefault;
      default:
        return locConstants.schemaDesigner.noAction;
    }
  },
};

// Constants for layout and dimensions
export const LAYOUT_CONSTANTS = {
  NODE_WIDTH: 300,
  NODE_MARGIN: 50,
  BASE_NODE_HEIGHT: 70,
  COLUMN_HEIGHT: 30,
  LAYOUT_OPTIONS: {
    rankdir: "LR",
    marginx: 50,
    marginy: 50,
    nodesep: 50,
    ranksep: 50,
  },
};

// Flow layout utilities
export const flowUtils = {
  getTableWidth: (): number =>
    LAYOUT_CONSTANTS.NODE_WIDTH + LAYOUT_CONSTANTS.NODE_MARGIN,

  getTableHeight: (table: SchemaDesigner.Table): number =>
    LAYOUT_CONSTANTS.BASE_NODE_HEIGHT +
    table.columns.length * LAYOUT_CONSTANTS.COLUMN_HEIGHT,

  generatePositions: (
    nodes: Node<SchemaDesigner.Table>[],
    edges: Edge<SchemaDesigner.ForeignKey>[],
  ): {
    nodes: Node<SchemaDesigner.Table>[];
    edges: Edge<SchemaDesigner.ForeignKey>[];
  } => {
    const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
    graph.setGraph(LAYOUT_CONSTANTS.LAYOUT_OPTIONS);

    for (const node of nodes) {
      if (node.hidden) continue;
      graph.setNode(node.id, {
        width: flowUtils.getTableWidth(),
        height: flowUtils.getTableHeight(node.data),
      });
    }

    for (const edge of edges) {
      if (edge.hidden) continue;
      const sourceNode = nodes.find((n) => n.id === edge.source);
      const targetNode = nodes.find((n) => n.id === edge.target);
      if (!sourceNode?.hidden && !targetNode?.hidden) {
        graph.setEdge(edge.source, edge.target);
      }
    }

    dagre.layout(graph);

    const layoutedNodes = nodes.map((node) => {
      if (node.hidden) return node;
      const dagreNode = graph.node(node.id);
      return {
        ...node,
        position: {
          x: dagreNode.x - flowUtils.getTableWidth() / 2,
          y: dagreNode.y - flowUtils.getTableHeight(node.data) / 2,
        },
      };
    });

    return {
      nodes: layoutedNodes,
      edges,
    };
  },

  generateSchemaDesignerFlowComponents: (
    schema: SchemaDesigner.Schema,
  ): {
    nodes: Node<SchemaDesigner.Table>[];
    edges: Edge<SchemaDesigner.ForeignKey>[];
  } => {
    if (!schema) {
      return { nodes: [], edges: [] };
    }

    const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
    graph.setGraph(LAYOUT_CONSTANTS.LAYOUT_OPTIONS);

    const rawNodes = schema.tables.map((table) => ({
      id: table.id,
      type: "tableNode",
      data: { ...table },
    }));

    // Layout nodes and connect tables via foreign keys
    rawNodes.forEach((node) => {
      graph.setNode(node.id, {
        width: flowUtils.getTableWidth(),
        height: flowUtils.getTableHeight(node.data),
      });

      node.data.foreignKeys.forEach((fk) => {
        const referencedTable = schema.tables.find(
          (t) =>
            t.name === fk.referencedTableName &&
            t.schema === fk.referencedSchemaName,
        );
        if (referencedTable) {
          graph.setEdge(node.id, referencedTable.id);
        }
      });
    });

    dagre.layout(graph);

    const layoutedNodes = rawNodes.map((node) => {
      const dagreNode = graph.node(node.id);

      return {
        ...node,
        position: {
          x: dagreNode.x - flowUtils.getTableWidth() / 2,
          y: dagreNode.y - flowUtils.getTableHeight(node.data) / 2,
        },
      };
    });

    const edges: Edge<SchemaDesigner.ForeignKey>[] = [];

    for (const table of schema.tables) {
      for (const fk of table.foreignKeys) {
        const referencedTable = schema.tables.find(
          (t) =>
            t.name === fk.referencedTableName &&
            t.schema === fk.referencedSchemaName,
        );

        if (!referencedTable) continue;

        fk.columns.forEach((col, idx) => {
          const refCol = fk.referencedColumns[idx];

          edges.push({
            id: `${table.name}-${referencedTable.name}-${col}-${refCol}`,
            source: table.id,
            target: referencedTable.id,
            sourceHandle: `right-${col}`,
            targetHandle: `left-${refCol}`,
            markerEnd: {
              type: MarkerType.ArrowClosed,
            },
            data: {
              name: fk.name,
              id: fk.id,
              columns: [col],
              referencedSchemaName: fk.referencedSchemaName,
              referencedTableName: fk.referencedTableName,
              referencedColumns: [refCol],
              onDeleteAction: fk.onDeleteAction,
              onUpdateAction: fk.onUpdateAction,
            },
            type:
              table.id === referencedTable.id
                ? ConnectionLineType.SmoothStep
                : undefined,
          });
        });
      }
    }

    return {
      nodes: layoutedNodes,
      edges,
    };
  },

  extractSchemaModel: (
    nodes: Node<SchemaDesigner.Table>[],
    edges: Edge<SchemaDesigner.ForeignKey>[],
  ): SchemaDesigner.Schema => {
    // Create a deep copy of the nodes to avoid mutating the original data
    const tables = nodes.map((node) => ({
      ...node.data,
      foreignKeys: [] as SchemaDesigner.ForeignKey[],
    }));

    // Process edges to create foreign keys
    edges.forEach((edge) => {
      const sourceNode = nodes.find((node) => node.id === edge.source);
      const targetNode = nodes.find((node) => node.id === edge.target);

      if (!sourceNode || !targetNode || !edge.data) {
        console.warn(
          `Edge ${edge.id} references non-existent nodes or has no data`,
        );
        return;
      }

      const foreignKey: SchemaDesigner.ForeignKey = {
        id: edge.data.id,
        name: edge.data.name,
        columns: [...edge.data.columns],
        referencedSchemaName: edge.data.referencedSchemaName,
        referencedTableName: edge.data.referencedTableName,
        referencedColumns: [...edge.data.referencedColumns],
        onDeleteAction: edge.data.onDeleteAction,
        onUpdateAction: edge.data.onUpdateAction,
      };

      // Find the table node that corresponds to the source of the edge
      const sourceTable = tables.find((node) => node.id === edge.source);
      if (!sourceTable) {
        console.warn(`Source table ${edge.source} not found`);
        return;
      }

      // Find if the foreign key already exists in the source table
      const existingForeignKey = sourceTable.foreignKeys.find(
        (fk) => fk.id === foreignKey.id,
      );

      if (existingForeignKey) {
        // Update the existing foreign key
        existingForeignKey.columns.push(foreignKey.columns[0]);
        existingForeignKey.referencedColumns.push(
          foreignKey.referencedColumns[0],
        );
      } else {
        // Add the new foreign key to the source table
        sourceTable.foreignKeys.push(foreignKey);
      }
    });
    return {
      tables: tables,
    };
  },
};
