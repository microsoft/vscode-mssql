import { Button, Popover, PopoverSurface, PopoverTrigger, Table, TableBody, TableCell, TableColumnDefinition, TableColumnId, TableColumnSizingOptions, TableHeader, TableHeaderCell, TableRow, TableRowData, Toolbar, ToolbarButton, createTableColumn, makeStyles, useTableColumnSizing_unstable, useTableFeatures } from "@fluentui/react-components"
import { CheckBoxProperties, DesignerDataPropertyInfo, DesignerEditType, DesignerTableComponentDataItem, DesignerTableProperties, DesignerUIArea, DropDownProperties, InputBoxProperties } from "./tableDesignerInterfaces"
import {
	AddRegular, NavigationFilled, DeleteRegular
} from "@fluentui/react-icons";
import { useContext, useState } from "react";
import { TableDesignerContext } from "./TableDesignerStateProvider";
import { DesignerCheckbox } from "./DesignerCheckbox";
import { DesignerDropdown } from "./DesignerDropdown";
import { DesignerInputBox } from "./DesignerInputBox";
import { ErrorCircleFilled } from "@fluentui/react-icons";

export type DesignerTableProps = {
	component: DesignerDataPropertyInfo,
	model: DesignerTableProperties,
	componentPath: (string | number)[],
	UiArea: DesignerUIArea,
	loadPropertiesTabData?: boolean
}

export type ErrorPopupProps = {
	message: string | undefined
}

const useStyles = makeStyles({
	tableCell: {
		display: 'flex',
		flexDirection: 'row',
	}
});

export const DesignerTable2 = ({
	component,
	model,
	componentPath,
	UiArea,
	loadPropertiesTabData = true
}: DesignerTableProps) => {
	const tableProps = component.componentProperties as DesignerTableProperties;
	const state = useContext(TableDesignerContext);
	const classes = useStyles();
	const columnsDef: TableColumnDefinition<DesignerTableComponentDataItem>[] = tableProps.columns!.map((column) => {
		const colProps = tableProps.itemProperties?.find(item => item.propertyName === column);
		return createTableColumn(
			{
				columnId: column,
				renderHeaderCell: () => <>{colProps?.componentProperties.title ?? column}</>
			}
		)
	});
	columnsDef.unshift(createTableColumn({
		columnId: 'dragHandle',
		renderHeaderCell: () => <></>,
	}));

	if (tableProps.canRemoveRows) {
		columnsDef.push(createTableColumn({
			columnId: 'remove',
			renderHeaderCell: () => <>Delete</>
		}));
	}

	const items: DesignerTableComponentDataItem[] = model.data?.map((row) => {
		return row;
	}) ?? [];

	const [columns] = useState<TableColumnDefinition<DesignerTableComponentDataItem>[]>(columnsDef);

	const sizingOptions: TableColumnSizingOptions = {
	};
	tableProps.columns!.forEach((column) => {
		const colProps = tableProps.itemProperties?.find(item => item.propertyName === column);
		sizingOptions[column] = {
			minWidth: (colProps?.componentProperties.width ?? 100) + 30,
			idealWidth: (colProps?.componentProperties.width ?? 100) + 30
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

	const [columnSizingOptions] = useState<TableColumnSizingOptions>(sizingOptions);

	const { getRows, columnSizing_unstable, tableRef } = useTableFeatures(
		{
			columns,
			items,
		},
		[useTableColumnSizing_unstable({ columnSizingOptions })]
	);

	const rows = getRows();

	const getRowError = (index: number): string | undefined => {
		const issue = state?.state.issues?.find(i => {
			return i.propertyPath!.join('.') === [...componentPath, index].join('.');
		});
		return issue?.description ?? undefined;
	}

	const getErrorPopup = (message: string | undefined) => {

		return <Popover>
			<PopoverTrigger disableButtonEnhancement>
				<Button appearance="subtle"
					aria-label={message}
					icon={<ErrorCircleFilled style={{
						marginTop: '5px'
					}} color="red" />}></Button>
			</PopoverTrigger>

			<PopoverSurface tabIndex={-1}>
				<div>
					<div>{message}</div>
				</div>
			</PopoverSurface>
		</Popover>;
	};

	const getTableCell = (row: TableRowData<DesignerTableComponentDataItem>, columnId: TableColumnId) => {
		const colProps = tableProps.itemProperties?.find(item => item.propertyName === columnId);
		const value = row.item[columnId];
		switch (columnId) {
			case 'dragHandle':
				return <div className={classes.tableCell}>
					{tableProps.canMoveRows && <Button appearance="subtle" size="small" icon={<NavigationFilled />} />}
					{
						getRowError(row.rowId as number) && getErrorPopup(getRowError(row.rowId as number))
					}
				</div>;
			case 'remove':
				return <Button disabled={row.item.canBeDeleted ? !row.item.canBeDeleted : false} appearance="subtle" size="small" icon={<DeleteRegular />}
					onClick={async () => {
						state?.provider.processTableEdit({
							path: [...componentPath, row.rowId],
							source: UiArea,
							type: DesignerEditType.Remove,
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
								model={value as InputBoxProperties}
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
						return <div className={classes.tableCell}><DesignerDropdown
							component={colProps}
							model={value as DropDownProperties}
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
					case 'checkbox': {
						return <div className={classes.tableCell}><DesignerCheckbox
							component={colProps}
							model={value as CheckBoxProperties}
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

	return <div>
		<Toolbar size='small'>
			{model.canAddRows &&
				<ToolbarButton
					icon={<AddRegular />}
					onClick={() => {
						state?.provider.processTableEdit({
							path: [...componentPath, rows.length],
							source: UiArea,
							type: DesignerEditType.Add,
							value: undefined
						})
					}}
				>
					{tableProps.labelForAddNewButton}
				</ToolbarButton>
			}
		</Toolbar>
		<Table
			size="small"
			{...columnSizing_unstable.getTableProps()}
			ref={tableRef}
		>
			<TableHeader>
				<TableRow>
					{
						columnsDef.map((column) => {
							return <TableHeaderCell
								{...columnSizing_unstable.getTableHeaderCellProps(column.columnId)}
								key={column.columnId}>
								{column.renderHeaderCell()}
							</TableHeaderCell>
						})
					}
				</TableRow>
			</TableHeader>
			<TableBody>
				{rows.map((row, index) => {
					return <TableRow draggable

						onFocus={(event) => {
							if (!loadPropertiesTabData) {
								return;
							}
							state?.provider.setPropertiesComponents({
								componentPath: [...componentPath, row.rowId],
								component: component,
								model: model
							});
							event.preventDefault();
						}}
						key={index}>
						{
							columnsDef.map((column) => {
								return <TableCell
									{...columnSizing_unstable.getTableCellProps(column.columnId)}
								>
									{getTableCell(row, column.columnId)}
								</TableCell>
							})}
					</TableRow>;
				})}
			</TableBody>
		</Table>
	</div>
}