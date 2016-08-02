
enum FieldType {
    String = 0,
    Boolean = 1,
    Integer = 2,
    Decimal = 3,
    Date = 4,
    Unknown = 5,
}

export interface IColumnDefinition {
    id: string;
    type: FieldType;
}
