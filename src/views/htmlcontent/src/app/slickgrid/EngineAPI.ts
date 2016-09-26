
export enum FieldType {
    String = 0,
    Boolean = 1,
    Integer = 2,
    Decimal = 3,
    Date = 4,
    Unknown = 5
}

export interface IColumnDefinition {
    id: string;
    type: FieldType;
    asyncPostRender?: (cellRef: string, row: number, dataContext: JSON, colDef: any) => void;
    formatter?: (row: number, cell: any, value: any, columnDef: any, dataContext: any) => string;
}
