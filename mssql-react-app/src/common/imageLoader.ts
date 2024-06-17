import { rpc } from "./rpc";

export async function getImageUrl(imagePath: string): Promise<string> {
	return await rpc.call('getImageUrl', imagePath) as string;
}