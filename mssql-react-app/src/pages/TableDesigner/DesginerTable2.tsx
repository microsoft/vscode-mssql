import { Button, Table, TableBody, TableCell, TableColumnDefinition, TableColumnSizingOptions, TableHeader, TableHeaderCell, TableRow, Toolbar, ToolbarButton, createTableColumn, useTableColumnSizing_unstable, useTableFeatures } from "@fluentui/react-components"
import { CheckBoxProperties, DesignerDataPropertyInfo, DesignerEditType, DesignerTableComponentDataItem, DesignerTableProperties, DesignerUIArea, DropDownProperties, InputBoxProperties } from "./tableDesignerInterfaces"
import {
	AddRegular, NavigationFilled, DeleteRegular
} from "@fluentui/react-icons";
import { useContext, useState } from "react";
import { TableDesignerContext } from "./TableDesignerStateProvider";
import { DesignerCheckbox } from "./DesignerCheckbox";
import { DesignerDropdown } from "./DesignerDropdown";
import { DesignerInputBox } from "./DesignerInputBox";

export type DesignerTableProps = {
	component: DesignerDataPropertyInfo,
	model: DesignerTableProperties,
	componentPath: (string | number)[],
	UiArea: DesignerUIArea,
	loadPropertiesTabData?: boolean
}

export const DesignerTable2 = ({
	component,
	model,
	componentPath,
	UiArea,
	loadPropertiesTabData = true
}: DesignerTableProps) => {
	const tableProps = component.componentProperties as DesignerTableProperties;
	const state = useContext(TableDesignerContext);

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

					onClick={(event) => {
						if (!loadPropertiesTabData) {
							return;
						}
						state?.provider.setPropertiesComponents({
							componentPath: [...componentPath, row.rowId],
							component:  component,
							model: model
						});
						event.preventDefault();
					}}
					key={index}>
						{columnsDef.map((column) => {
							const colProps = tableProps.itemProperties?.find(item => item.propertyName === column.columnId);
							const value = row.item[column.columnId];
							switch (column.columnId) {
								case 'dragHandle':
									return <TableCell
										{...columnSizing_unstable.getTableCellProps(column.columnId)}
									>
										{tableProps.canMoveRows && <Button appearance="subtle" size="small" icon={<NavigationFilled />} />}
									</TableCell>
								case 'remove':
									return <TableCell
										{...columnSizing_unstable.getTableCellProps(column.columnId)}
									>
										<Button disabled={row.item.canBeDeleted ? !row.item.canBeDeleted : false} appearance="subtle" size="small" icon={<DeleteRegular />}
											onClick={async () => {
												state?.provider.processTableEdit({
													path: [...componentPath, row.rowId],
													source: UiArea,
													type: DesignerEditType.Remove,
													value: undefined
												});
											}}
										/>
									</TableCell>
								default: {
									switch (colProps?.componentType) {
										case 'input':
											return <TableCell
												{...columnSizing_unstable.getTableCellProps(column.columnId)}
											>
												<DesignerInputBox
													component={colProps}
													model={value as InputBoxProperties}
													componentPath={[...componentPath, row.rowId, column.columnId]}
													UiArea={UiArea}
													showLabel={false}
													showError={false}
												/>
											</TableCell>
										case 'dropdown':
											return <TableCell
												{...columnSizing_unstable.getTableCellProps(column.columnId)}
											>
												<DesignerDropdown
													component={colProps}
													model={value as DropDownProperties}
													componentPath={[...componentPath, row.rowId, column.columnId]}
													UiArea={UiArea}
													showLabel={false}
													showError={false}
												/>
											</TableCell>
										case 'checkbox': {
											return <TableCell
												{...columnSizing_unstable.getTableCellProps(column.columnId)}
											>
												<DesignerCheckbox
													component={colProps}
													model={value as CheckBoxProperties}
													componentPath={[...componentPath, row.rowId, column.columnId]}
													UiArea={UiArea}
													showLabel={false}
												/>
											</TableCell>
										}
										default:
											return <TableCell
												{...columnSizing_unstable.getTableCellProps(column.columnId)}
											>
												Unknown component type
											</TableCell>
									}
								}
							}
						})}
					</TableRow>;
				})}
			</TableBody>
		</Table>
	</div>
}