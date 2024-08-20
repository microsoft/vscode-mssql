declare const assetPathVscodeUri: string;

export function loadImage(path: string): string {
	const loadPath =  assetPathVscodeUri + '/' + path;
	return loadPath;
}