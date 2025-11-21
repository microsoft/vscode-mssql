/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotificationType } from "vscode-jsonrpc/browser";

/**
 * Definition for the table designer service.
 */
export interface ITableDesignerService {
  /**
   * Initialize the table designer for the specified table.
   * @param table the table information.
   */
  initializeTableDesigner(table: TableInfo): Thenable<TableDesignerInfo>;

  /**
   * Process the table change.
   * @param table the table information
   * @param tableChangeInfo the information about the change user made through the UI.
   */
  processTableEdit(
    table: TableInfo,
    tableChangeInfo: DesignerEdit,
  ): Thenable<DesignerEditResult<TableDesignerView>>;

  /**
   * Publish the changes.
   * @param table the table information
   */
  publishChanges(table: TableInfo): Thenable<PublishChangesResult>;

  /**
   * Generate script for the changes.
   * @param table the table information
   */
  generateScript(table: TableInfo): Thenable<string>;

  /**
   * Generate preview report describing the changes to be made.
   * @param table the table information
   */
  generatePreviewReport(
    table: TableInfo,
  ): Thenable<GeneratePreviewReportResult>;

  /**
   * Notify the provider that the table designer has been closed.
   * @param table the table information
   */
  disposeTableDesigner(table: TableInfo): Thenable<void>;
}

/**
 * The information of the table.
 */
export interface TableInfo {
  /**
   * Used as the table designer editor's tab header text (as well as the base value of the tooltip).
   */
  title: string;
  /**
   * Used as the table designer editor's tab header name text.
   */
  tooltip: string;
  /**
   * Unique identifier of the table. Will be used to decide whether a designer is already opened for the table.
   */
  id: string;
  /**
   * A boolean value indicates whether a new table is being designed.
   */
  isNewTable: boolean;
  /**
   * Extension can store additional information that the provider needs to uniquely identify a table.
   */
  [key: string]: any;
  /**
   * Table icon type that's shown in the editor tab. Default is the basic
   * table icon.
   */
  tableIcon?: TableIcon;
  /**
   * Additional information for tooltip on hover displaying the full information of the connection.
   */
  additionalInfo?: string;
  /**
   * Access token to be used for Azure MFA authentication.
   */
  accessToken?: string;
}

/**
 * The information to populate the table designer UI.
 */
export interface TableDesignerInfo {
  /**
   * The view definition.
   */
  view: TableDesignerView;
  /**
   * The initial state of the designer.
   */
  viewModel: DesignerViewModel;
  /**
   * The new table info after initialization.
   */
  tableInfo: TableInfo;
  /**
   * The issues.
   */
  issues?: DesignerIssue[];
}

/**
 * Table icon that's shown on the editor tab
 */
export enum TableIcon {
  Basic = "Basic",
  Temporal = "Temporal",
  GraphNode = "GraphNode",
  GraphEdge = "GraphEdge",
}

/**
 * Name of the common table properties.
 * Extensions can use the names to access the designer view model.
 */
export enum TableProperty {
  Columns = "columns",
  Description = "description",
  Name = "name",
  Schema = "schema",
  Script = "script",
  ForeignKeys = "foreignKeys",
  CheckConstraints = "checkConstraints",
  Indexes = "indexes",
  PrimaryKey = "primaryKey",
  PrimaryKeyName = "primaryKeyName",
  PrimaryKeyDescription = "primaryKeyDescription",
  PrimaryKeyColumns = "primaryKeyColumns",
}
/**
 * Name of the common table column properties.
 * Extensions can use the names to access the designer view model.
 */
export enum TableColumnProperty {
  AllowNulls = "allowNulls",
  DefaultValue = "defaultValue",
  Length = "length",
  Name = "name",
  Description = "description",
  Type = "type",
  AdvancedType = "advancedType",
  IsPrimaryKey = "isPrimaryKey",
  Precision = "precision",
  Scale = "scale",
  IsIdentity = "isIdentity",
}

/**
 * Name of the common foreign key constraint properties.
 * Extensions can use the names to access the designer view model.
 */
export enum TableForeignKeyProperty {
  Name = "name",
  Description = "description",
  ForeignTable = "foreignTable",
  OnDeleteAction = "onDeleteAction",
  OnUpdateAction = "onUpdateAction",
  Columns = "columns",
}

/**
 * Name of the columns mapping properties for foreign key.
 */
export enum ForeignKeyColumnMappingProperty {
  Column = "column",
  ForeignColumn = "foreignColumn",
}

/**
 * Name of the common check constraint properties.
 * Extensions can use the name to access the designer view model.
 */
export enum TableCheckConstraintProperty {
  Name = "name",
  Description = "description",
  Expression = "expression",
}

/**
 * Name of the common index properties.
 * Extensions can use the name to access the designer view model.
 */
export enum TableIndexProperty {
  Name = "name",
  Description = "description",
  Columns = "columns",
  IncludedColumns = "includedColumns",
  ColumnStoreIndex = "columnStoreIndexes",
}

/**
 * Name of the common properties of table index column specification.
 */
export enum TableIndexColumnSpecificationProperty {
  Column = "column",
}

/**
 * The table designer view definition.
 */
export interface TableDesignerView {
  /**
   * Additional table properties. Common table properties are handled by Azure Data Studio. see {@link TableProperty}
   */
  additionalTableProperties?: DesignerDataPropertyInfo[];
  /**
   * Additional tabs.
   */
  additionalTabs?: DesignerTab[];
  /**
   * Columns table options.
   * Common table columns properties are handled by Azure Data Studio. see {@link TableColumnProperty}.
   * Default columns to display values are: Name, Type, Length, Precision, Scale, IsPrimaryKey, AllowNulls, DefaultValue.
   */
  columnTableOptions?: TableDesignerBuiltInTableViewOptions;
  /**
   * Foreign keys table options.
   * Common foreign key properties are handled by Azure Data Studio. see {@link TableForeignKeyProperty}.
   * Default columns to display values are: Name, PrimaryKeyTable.
   */
  foreignKeyTableOptions?: TableDesignerBuiltInTableViewOptions;
  /**
   * Foreign key column mapping table options.
   * Common foreign key column mapping properties are handled by Azure Data Studio. see {@link ForeignKeyColumnMappingProperty}.
   * Default columns to display values are: Column, ForeignColumn.
   */
  foreignKeyColumnMappingTableOptions?: TableDesignerBuiltInTableViewOptions;
  /**
   * Check constraints table options.
   * Common check constraint properties are handled by Azure Data Studio. see {@link TableCheckConstraintProperty}
   * Default columns to display values are: Name, Expression.
   */
  checkConstraintTableOptions?: TableDesignerBuiltInTableViewOptions;
  /**
   * Indexes table options.
   * Common index properties are handled by Azure Data Studio. see {@link TableIndexProperty}
   * Default columns to display values are: Name.
   */
  indexTableOptions?: TableDesignerBuiltInTableViewOptions;
  /**
   * Index column specification table options.
   * Common index properties are handled by Azure Data Studio. see {@link TableIndexColumnSpecificationProperty}
   * Default columns to display values are: Column.
   */
  indexColumnSpecificationTableOptions?: TableDesignerBuiltInTableViewOptions;
  /**
   * Primary column specification table options.
   * Common index properties are handled by Azure Data Studio. see {@link TableIndexColumnSpecificationProperty}
   * Default columns to display values are: Column.
   */
  primaryKeyColumnSpecificationTableOptions?: TableDesignerBuiltInTableViewOptions;
  /**
   * Additional primary key properties. Common primary key properties: primaryKeyName, primaryKeyDescription.
   */
  additionalPrimaryKeyProperties?: DesignerDataPropertyInfo[];
  /**
   * Components to be placed under the pre-defined tabs.
   */
  additionalComponents?: DesignerDataPropertyWithTabInfo[];
  /**
   * Whether to use advanced save mode. for advanced save mode, a publish changes dialog will be opened with preview of changes.
   */
  useAdvancedSaveMode: boolean;
}

export interface TableDesignerBuiltInTableViewOptions
  extends DesignerTablePropertiesBase {
  /**
   * Whether to show the table. Default value is false.
   */
  showTable?: boolean;
  /**
   * Properties to be displayed in the table, other properties can be accessed in the properties view.
   */
  propertiesToDisplay?: string[];
  /**
   * Additional properties for the entity.
   */
  additionalProperties?: DesignerDataPropertyInfo[];
}

/**
 * The view model of the designer.
 */
export interface DesignerViewModel {
  [key: string]:
    | InputBoxProperties
    | CheckBoxProperties
    | DropDownProperties
    | DesignerTableProperties;
}

/**
 * The definition of a designer tab.
 */
export interface DesignerTab {
  /**
   * The title of the tab.
   */
  title: string;
  /**
   * the components to be displayed in this tab.
   */
  components: DesignerDataPropertyInfo[];
  id: string;
}

/**
 * The definition of the property in the designer.
 */
export interface DesignerDataPropertyInfo {
  /**
   * The property name.
   */
  propertyName: string;
  /**
   * The description of the property.
   */
  description?: string;
  /**
   * The component type.
   */
  componentType: DesignerComponentTypeName;
  /**
   * The group name, properties with the same group name will be displayed under the same group on the UI.
   */
  group?: string;
  /**
   * Whether the property should be displayed in the properties view. The default value is true.
   */
  showInPropertiesView?: boolean;
  /**
   * The properties of the component.
   */
  componentProperties:
    | InputBoxProperties
    | CheckBoxProperties
    | DropDownProperties
    | DesignerTableProperties;
}

/**
 * The definition of the property in the designer with tab info.
 */
export interface DesignerDataPropertyWithTabInfo
  extends DesignerDataPropertyInfo {
  /**
   * The tab info where this property belongs to.
   */
  tab:
    | TableProperty.Columns
    | TableProperty.PrimaryKey
    | TableProperty.ForeignKeys
    | TableProperty.CheckConstraints
    | TableProperty.Indexes;
}

/**
 * The child component types supported by designer.
 */
export type DesignerComponentTypeName =
  | "input"
  | "checkbox"
  | "dropdown"
  | "table"
  | "textarea";

export interface DesignerTablePropertiesBase {
  /**
   * Whether user can add new rows to the table. The default value is true.
   */
  canAddRows?: boolean;
  /**
   * Whether user can remove rows from the table. The default value is true.
   */
  canRemoveRows?: boolean;
  /**
   * Whether user can move rows from one index to another. The default value is true.
   */
  canMoveRows?: boolean;
  /**
   * Whether user can insert rows at a given index to the table. The default value is true.
   */
  canInsertRows?: boolean;
  /**
   * Whether to show confirmation when user removes a row. The default value is false.
   */
  showRemoveRowConfirmation?: boolean;
  /**
   * The confirmation message to be displayed when user removes a row.
   */
  removeRowConfirmationMessage?: string;
  /**
   * Whether to show the item detail in properties view. The default value is true.
   */
  showItemDetailInPropertiesView?: boolean;
  /**
   * The label of the add new button. The default value is 'Add New'.
   */
  labelForAddNewButton?: string;
  /**
   * Groups that are expanded in properties view. The default value is empty.
   */
  expandedGroups?: string[];
}

/**
 * The properties for the table component in the designer.
 */
export interface DesignerTableProperties
  extends TableDesignerComponentProperties,
    DesignerTablePropertiesBase {
  /**
   * the name of the properties to be displayed, properties not in this list will be accessible in properties pane.
   */
  columns?: string[];
  /**
   * The display name of the object type.
   */
  objectTypeDisplayName?: string;
  /**
   * the properties of the table data item.
   */
  itemProperties?: DesignerDataPropertyInfo[];
  /**
   * The data to be displayed.
   */
  data?: DesignerTableComponentDataItem[];
}

/**
 * The data item of the designer's table component.
 */
export interface DesignerTableComponentDataItem {
  [key: string]:
    | InputBoxProperties
    | CheckBoxProperties
    | DropDownProperties
    | DesignerTableProperties
    | boolean;
  /**
   * Whether the row can be deleted. The default value is true.
   */
  canBeDeleted: boolean;
}

/**
 * Type of the edit originated from the designer UI.
 */
export enum DesignerEditType {
  /**
   * Add a row to a table.
   */
  Add = 0,
  /**
   * Remove a row from a table.
   */
  Remove = 1,
  /**
   * Update a property.
   */
  Update = 2,
  /**
   * Change the position of an item in the collection.
   */
  Move = 3,
}

/**
 * Information of the edit originated from the designer UI.
 */
export interface DesignerEdit {
  /**
   * The edit type.
   */
  type: DesignerEditType;
  /**
   * the path of the edit target.
   */
  path: DesignerPropertyPath;
  /**
   * the new value.
   */
  value?: any;
  /**
   * The UI area where the edit originated.
   */
  source: DesignerUIArea;
}

/**
 * The path of the property.
 * Below are the 3 scenarios and their expected path.
 * Note: 'index-{x}' in the description below are numbers represent the index of the object in the list.
 * 1. 'Add' scenario
 *     a. ['propertyName1']. Example: add a column to the columns property: ['columns'].
 *     b. ['propertyName1',index-1,'propertyName2']. Example: add a column mapping to the first foreign key: ['foreignKeys',0,'mappings'].
 * 2. 'Update' scenario
 *     a. ['propertyName1']. Example: update the name of the table: ['name'].
 *     b. ['propertyName1',index-1,'propertyName2']. Example: update the name of a column: ['columns',0,'name'].
 *     c. ['propertyName1',index-1,'propertyName2',index-2,'propertyName3']. Example: update the source column of an entry in a foreign key's column mapping table: ['foreignKeys',0,'mappings',0,'source'].
 * 3. 'Remove' scenario
 *     a. ['propertyName1',index-1]. Example: remove a column from the columns property: ['columns',0'].
 *     b. ['propertyName1',index-1,'propertyName2',index-2]. Example: remove a column mapping from a foreign key's column mapping table: ['foreignKeys',0,'mappings',0].
 */
export type DesignerPropertyPath = (string | number)[];

/**
 * Severity of the messages returned by the provider after processing an edit.
 * 'error': The issue must be fixed in order to commit the changes.
 * 'warning': Inform the user the potential risks with the current state. e.g. Having multiple edge constraints is only useful as a temporary state.
 * 'information': Informational message.
 */
export type DesignerIssueSeverity = "error" | "warning" | "information";

/**
 * Represents the issue in the designer
 */
export interface DesignerIssue {
  /**
   * Severity of the issue.
   */
  severity: DesignerIssueSeverity;
  /**
   * Path of the property that is associated with the issue.
   */
  propertyPath?: DesignerPropertyPath;
  /**
   * Description of the issue.
   */
  description: string;
  /**
   * Url to a web page that has the explanation of the issue.
   */
  moreInfoLink?: string;
}

/**
 * The result returned by the table designer provider after handling an edit request.
 */
export interface DesignerEditResult<T> {
  /**
   * The new view information if the view needs to be refreshed.
   */
  view?: T;
  /**
   * The view model object.
   */
  viewModel: DesignerViewModel;
  /**
   * Whether the current state is valid.
   */
  isValid: boolean;
  /**
   * Issues of current state.
   */
  issues?: DesignerIssue[];
  /**
   * The input validation error.
   */
  inputValidationError?: string;
  /**
   * Metadata related to the table
   */
  metadata?: { [key: string]: string };
}

/**
 * The result returned by the table designer provider after handling the publish changes request.
 */
export interface PublishChangesResult {
  /**
   * The new table information after the changes are published.
   */
  newTableInfo: TableInfo;
  /**
   * The new view model.
   */
  viewModel: DesignerViewModel;
  /**
   * The new view.
   */
  view: TableDesignerView;
  /**
   * Metadata related to the table to be captured
   */
  metadata?: { [key: string]: string };
}

export interface GeneratePreviewReportResult {
  /**
   * Report generated for generate preview
   */
  report: string;
  /**
   * Format (mimeType) of the report
   */
  mimeType: string;
  /**
   * Whether user confirmation is required, the default value is false.
   */
  requireConfirmation?: boolean;
  /**
   * The confirmation text.
   */
  confirmationText?: string;
  /**
   * The table schema validation error.
   */
  schemaValidationError?: string;
  /**
   * Metadata related to the table to be captured
   */
  metadata?: { [key: string]: string };
}

export interface TableDesignerComponentProperties {
  title?: string;
  ariaLabel?: string;
  width?: number;
  enabled?: boolean;
}

export interface CheckBoxProperties extends TableDesignerComponentProperties {
  checked: boolean;
}

export interface DropDownProperties extends TableDesignerComponentProperties {
  values: string[];
  value: string;
  isEditable?: boolean;
}

export enum InputBoxType {
  TEXT,
  NUMBER,
}

export interface InputBoxProperties extends TableDesignerComponentProperties {
  value: string;
  inputType?: InputType;
}

export interface TableProperties extends TableDesignerComponentProperties {
  columns: string[];
  objectTypeDisplayName?: string;
  itemProperties: DesignerDataPropertyInfo[];
  data: DesignerTableComponentDataItem[];
  canAddRows: boolean;
  canRemoveRows: boolean;
  canMoveRows: boolean;
  canInsertRows: boolean;
  showRemoveRowConfirmation: boolean;
  removeRowConfirmationMessage: string;
  labelForAddNewButton: string;
}

export enum LoadState {
  NotStarted = "NotStarted",
  Loading = "Loading",
  Loaded = "Loaded",
  Error = "Error",
}

export enum DesignerMainPaneTabs {
  AboutTable = "general",
  Columns = "columns",
  PrimaryKey = "primaryKey",
  ForeignKeys = "foreignKeys",
  Indexes = "indexes",
  CheckConstraints = "checkConstraints",
}

export enum DesignerResultPaneTabs {
  Script = "script",
  Issues = "issues",
}

export interface DesignerAPIState {
  initializeState: LoadState;
  editState: LoadState;
  publishState: LoadState;
  previewState: LoadState;
  generateScriptState: LoadState;
}

export interface DesignerTabStates {
  mainPaneTab: DesignerMainPaneTabs;
  resultPaneTab: DesignerResultPaneTabs;
}

export interface PropertiesPaneData {
  componentPath: (string | number)[];
  component: DesignerDataPropertyInfo;
  model: DesignerTableProperties;
}

export interface TableDesignerWebviewState {
  tableInfo?: TableInfo;
  view?: DesignerView;
  model?: DesignerViewModel;
  issues?: DesignerIssue[];
  isValid?: boolean;
  generateScriptResult?: string;
  generatePreviewReportResult?: GeneratePreviewReportResult;
  publishChangesResult?: PublishChangesResult;
  apiState?: DesignerAPIState;
  tabStates?: DesignerTabStates;
  propertiesPaneData?: PropertiesPaneData;
  publishingError?: string;
}

export interface DesignerView {
  tabs: DesignerTab[];
}

export enum InputType {
  Text = "text",
  Number = "number",
}

export interface TableDesignerReducers {
  processTableEdit: {
    table: TableInfo;
    tableChangeInfo: DesignerEdit;
  };
  publishChanges: {
    table: TableInfo;
  };
  generateScript: {
    table: TableInfo;
  };
  generatePreviewReport: {
    table: TableInfo;
  };
  setTab: {
    tabId: DesignerMainPaneTabs;
  };
  setPropertiesComponents: {
    components: PropertiesPaneData;
  };
  setResultTab: {
    tabId: DesignerResultPaneTabs;
  };
  continueEditing: {};
}

export type DesignerUIArea =
  | "PropertiesView"
  | "ScriptView"
  | "TopContentView"
  | "TabsView";

export interface ScriptAsCreateParams {
  script: string;
}

export interface CopyScriptAsCreateToClipboardParams {
  script: string;
}

export interface CopyPublishErrorToClipboardParams {
  error: string;
}

export namespace ScriptAsCreateNotification {
  export const type = new NotificationType<ScriptAsCreateParams>(
    "scriptAsCreate",
  );
}

export namespace CopyScriptAsCreateToClipboardNotification {
  export const type = new NotificationType<CopyScriptAsCreateToClipboardParams>(
    "copyScriptAsCreateToClipboard",
  );
}

export namespace CloseDesignerNotification {
  export const type = new NotificationType<void>("closeDesigner");
}

export namespace CopyPublishErrorToClipboardNotification {
  export const type = new NotificationType<CopyPublishErrorToClipboardParams>(
    "copyPublishErrorToClipboard",
  );
}

export namespace InitializeTableDesignerNotification {
  export const type = new NotificationType<void>("initializeTableDesigner");
}
