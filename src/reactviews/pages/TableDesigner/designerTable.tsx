/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fluentui from '@fluentui/react-components';
import * as designer from '../../../sharedInterfaces/tableDesigner';
import {
	AddRegular, NavigationFilled, DeleteRegular, ErrorCircleFilled, ArrowCircleUpFilled, ArrowCircleDownFilled
} from "@fluentui/react-icons";
import { useContext, useState } from "react";
import { TableDesignerContext } from "./tableDesignerStateProvider";
import { DesignerCheckbox } from "./designerCheckbox";
import { DesignerDropdown } from "./designerDropdown";
import { DesignerInputBox } from "./designerInputBox";
import * as l10n from "@vscode/l10n";

export type DesignerTableProps = {
	component: designer.DesignerDataPropertyInfo,
	model: designer.DesignerTableProperties,
	componentPath: (string | number)[],
	UiArea: designer.DesignerUIArea,
	loadPropertiesTabData?: boolean
}

export type ErrorPopupProps = {
	message: string | undefined
}

const useStyles = fluentui.makeStyles({
	tableCell: {
		display: 'flex',
		flexDirection: 'row',
	}
});

export const DesignerTable = ({
	component,
	model,
	componentPath,
	UiArea,
	loadPropertiesTabData = true
}: DesignerTableProps) => {
	const tableProps = component.componentProperties as designer.DesignerTableProperties;
	const state = useContext(TableDesignerContext);
	const classes = useStyles();

	const MOVE_UP = l10n.t('Move Up');
	const MOVE_DOWN = l10n.t('Move Down');

	const columnsDef: fluentui.TableColumnDefinition<designer.DesignerTableComponentDataItem>[] = tableProps.columns!.map((column) => {
		const colProps = tableProps.itemProperties?.find(item => item.propertyName === column);
		return fluentui.createTableColumn(
			{
				columnId: column,
				renderHeaderCell: () => <>{colProps?.componentProperties.title ?? column}</>
			}
		)
	});
	columnsDef.unshift(fluentui.createTableColumn({
		columnId: 'dragHandle',
		renderHeaderCell: () => <></>,
	}));

	if (tableProps.canRemoveRows) {
		columnsDef.push(fluentui.createTableColumn({
			columnId: 'remove',
			renderHeaderCell: () => {
				const DELETE = l10n.t('Delete');
				return <>{DELETE}</>;
			}
		}));
	}

	const items: designer.DesignerTableComponentDataItem[] = model.data?.map((row) => {
		return row;
	}) ?? [];

	const [columns] = useState<fluentui.TableColumnDefinition<designer.DesignerTableComponentDataItem>[]>(columnsDef);

	const sizingOptions: fluentui.TableColumnSizingOptions = {
	};
	tableProps.columns!.forEach((column) => {
		const colProps = tableProps.itemProperties?.find(item => item.propertyName === column);
		sizingOptions[column] = {
			minWidth: (colProps?.componentProperties.width ?? 100) + 50,
			idealWidth: (colProps?.componentProperties.width ?? 100) + 50
		}
	});
	sizingOptions['dragHandle'] = {
		minWidth: 30,
		idealWidth: 30,
		defaultWidth: 30
	};
	sizingOptions['remove'] = {
		minWidth: 100,
		idealWidth: 100,
		defaultWidth: 100
	};

	const [columnSizingOptions] = useState<fluentui.TableColumnSizingOptions>(sizingOptions);

	const { getRows, columnSizing_unstable, tableRef } = fluentui.useTableFeatures(
		{
			columns,
			items,
		},
		[fluentui.useTableColumnSizing_unstable({ columnSizingOptions })]
	);

	const rows = getRows();

	const moveRows = (from: number, to: number) => {
		state?.provider.processTableEdit({
			type: designer.DesignerEditType.Move,
			path: [...componentPath, from],
			value: to,
			source: UiArea
		});

		// Focus on the first cell of the moved row
		const firstCellElementId = state?.provider.getComponentId([...componentPath, to, columns[1].columnId]);
		document.getElementById(firstCellElementId!)?.focus();
		//setFocusedRowId(to);
	}

	const getRowError = (index: number): string | undefined => {
		const issue = state?.state.issues?.find(i => {
			return i.propertyPath!.join('.') === [...componentPath, index].join('.');
		});
		return issue?.description ?? undefined;
	}

	const getErrorPopup = (message: string | undefined) => {

		return <fluentui.Popover>
			<fluentui.PopoverTrigger disableButtonEnhancement>
				<fluentui.Button appearance="subtle"
					aria-label={message}
					icon={<ErrorCircleFilled style={{
						marginTop: '5px',
						marginLeft: '5px'
					}} color="red" />}></fluentui.Button>
			</fluentui.PopoverTrigger>

			<fluentui.PopoverSurface tabIndex={-1}>
				<div>
					<div>{message}</div>
				</div>
			</fluentui.PopoverSurface>
		</fluentui.Popover>;
	};

	const getTableCell = (row: fluentui.TableRowData<designer.DesignerTableComponentDataItem>, columnId: fluentui.TableColumnId) => {
		const colProps = tableProps.itemProperties?.find(item => item.propertyName === columnId);
		const value = row.item[columnId];
		switch (columnId) {
			case 'dragHandle':
				return <div className={classes.tableCell}>
					{tableProps.canMoveRows && <fluentui.Button appearance="subtle" size="small" icon={<NavigationFilled />} />}
					{
						getRowError(row.rowId as number) && getErrorPopup(getRowError(row.rowId as number))
					}
				</div>;
			case 'remove':
				return <fluentui.Button disabled={row.item.canBeDeleted ? !row.item.canBeDeleted : false} appearance="subtle" size="small" icon={<DeleteRegular />}
					onClick={async () => {
						state?.provider.processTableEdit({
							path: [...componentPath, row.rowId],
							source: UiArea,
							type: designer.DesignerEditType.Remove,
							value: undefined
						});
					}}
				/>
			default: {
				switch (colProps?.componentType) {
					case 'input':
						return <div className={classes.tableCell}>
							<DesignerInputBox
								component={colProps}
								model={value as designer.InputBoxProperties}
								componentPath={[...componentPath, row.rowId, columnId]}
								UiArea={UiArea}
								showLabel={false}
								showError={false}
							/>
							{

								state?.provider.getErrorMessage([...componentPath, row.rowId, columnId]) &&
								getErrorPopup(state?.provider.getErrorMessage([...componentPath, row.rowId, columnId]))
							}
						</div>
					case 'dropdown':
						return <div className={classes.tableCell}>
							<DesignerDropdown
								component={colProps}
								model={value as designer.DropDownProperties}
								componentPath={[...componentPath, row.rowId, columnId]}
								UiArea={'TabsView'}
								showLabel={false}
								showError={false}
							/>
							{
								state?.provider.getErrorMessage([...componentPath, row.rowId, columnId]) &&
								getErrorPopup(state?.provider.getErrorMessage([...componentPath, row.rowId, columnId]))
							}
						</div>
					case 'checkbox': {
						return <div className={classes.tableCell}>
							<DesignerCheckbox
								component={colProps}
								model={value as designer.CheckBoxProperties}
								componentPath={[...componentPath, row.rowId, columnId]}
								UiArea={UiArea}
								showLabel={false}
							/>
							{
								state?.provider.getErrorMessage([...componentPath, row.rowId, columnId]) &&
								getErrorPopup(state?.provider.getErrorMessage([...componentPath, row.rowId, columnId]))
							}
						</div>
					}
					default:
						return 'Unknown component type';
				}
			}
		}
	}

	const [draggedRowId, setDraggedRowId] = useState<number | undefined>(undefined);
	const [draggedOverRowId, setDraggedOverRowId] = useState<number | undefined>(undefined);
	const [focusedRowId, setFocusedRowId] = useState<number | undefined>(undefined);

	return <div>
		<fluentui.Toolbar size='small'>
			{
				tableProps.canAddRows &&
				<fluentui.ToolbarButton
					icon={<AddRegular />}
					onClick={() => {
						state?.provider.processTableEdit({
							path: [...componentPath, rows.length],
							source: UiArea,
							type: designer.DesignerEditType.Add,
							value: undefined
						})
					}}
				>
					{tableProps.labelForAddNewButton}
				</fluentui.ToolbarButton>
			}
			{
				tableProps.canMoveRows &&
				<fluentui.ToolbarButton
					icon={<ArrowCircleUpFilled />}
					onClick={(event) => {
						(event.target as HTMLElement).focus();
						moveRows(focusedRowId!, focusedRowId! - 1);
					}}
					disabled={focusedRowId === undefined || focusedRowId === 0}
				>
					{MOVE_UP}
				</fluentui.ToolbarButton>
			}
			{
				tableProps.canMoveRows &&
				<fluentui.ToolbarButton
					icon={<ArrowCircleDownFilled />}
					onClick={(event) => {
						(event.target as HTMLElement).focus();
						moveRows(focusedRowId!, focusedRowId! + 1);
					}}
					disabled={focusedRowId === undefined || focusedRowId === rows.length - 1}
				>
					{MOVE_DOWN}
				</fluentui.ToolbarButton>
			}

		</fluentui.Toolbar>
		<fluentui.Table
			as="table"
			size="small"
			{...columnSizing_unstable.getTableProps()}
			ref={tableRef}
		>
			<fluentui.TableHeader>
				<fluentui.TableRow>
					{
						columnsDef.map((column) => {
							return <fluentui.TableHeaderCell
								{...columnSizing_unstable.getTableHeaderCellProps(column.columnId)}
								key={column.columnId}>
								{column.renderHeaderCell()}
							</fluentui.TableHeaderCell>
						})
					}
				</fluentui.TableRow>
			</fluentui.TableHeader>
			<fluentui.TableBody>
				{rows.map((row, index) => {
					return <fluentui.TableRow draggable={tableProps.canMoveRows}
						onFocus={(event) => {
							if (!loadPropertiesTabData) {
								return;
							}
							state?.provider.setPropertiesComponents({
								componentPath: [...componentPath, row.rowId],
								component: component,
								model: model
							});
							setFocusedRowId(index);
							event.preventDefault();
						}}
						key={componentPath.join('.') + index}

						onDragEnter={() => {
							setDraggedOverRowId(index);
						}}

						onDragEnd={() => {
							if (draggedRowId === undefined || draggedOverRowId === undefined) {
								return;
							}
							moveRows(draggedRowId, draggedOverRowId);
							setDraggedRowId(undefined);
						}}

						onDrag={() => {
							setDraggedRowId(index);
						}}
						onDragStart={() => {
							setDraggedOverRowId(undefined);
							setDraggedRowId(index);
						}}
					>
						{
							columnsDef.map((column, columnIndex) => {
								return <fluentui.TableCell
									key={componentPath.join('.') + index + columnIndex}
									{...columnSizing_unstable.getTableCellProps(column.columnId)}
									id={`table-cell-${state?.state.tableInfo?.id}-${componentPath.join('-')}_${index}-${columnIndex}`}
								>
									{getTableCell(row, column.columnId)}
								</fluentui.TableCell>
							})
						}
					</fluentui.TableRow>;
				})}
			</fluentui.TableBody>
		</fluentui.Table>
	</div>
}