
import InfrastructureEnums = require('./Enums.ts');

export interface IColumnDefinition {
	id: string;
	type: InfrastructureEnums.FieldType;
}
