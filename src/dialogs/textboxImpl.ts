import { ComponentImpl } from "./componentImpl";
import { TextComponentProperties, ModelComponentTypes } from "./interfaces";


export class TextComponentImpl extends ComponentImpl implements TextComponentProperties {

	constructor(id: string) {
		super(ModelComponentTypes.Text, id,);
		this.properties = {};
	}

	public get value(): string {
		return this.properties['value'];
	}
	public set value(v: string) {
		this.setProperty('value', v);
	}

	public get title(): string {
		return this.properties['title'];
	}
	public set title(title: string) {
		this.setProperty('title', title);
	}

	public get requiredIndicator(): boolean {
		return this.properties['requiredIndicator'];
	}
	public set requiredIndicator(requiredIndicator: boolean) {
		this.setProperty('requiredIndicator', requiredIndicator);
	}
}