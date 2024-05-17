import { ReactNode, createContext, useEffect, useState } from "react";
import { getImageUrl } from "./utils/imageLoader";
import reactLogo from './assets/react.svg';
import viteLogo from '/vite.svg'
// Define the shape of the image sources state

export enum ImageKeys {
	vite,
	react
}

export const ImageMap: Record<ImageKeys, string> = {
	[ImageKeys.vite]: viteLogo,
	[ImageKeys.react]: reactLogo,
};

interface ImageContextType {
	imageSources: Record<ImageKeys, string>;
}

const ImageContext = createContext<ImageContextType | undefined>(undefined);

interface ImageProviderProps {
	children: ReactNode;
}
const ImageProvider: React.FC<ImageProviderProps> = ({ children }) => {

	const [imageSources, setImageSources] = useState<Record<ImageKeys, string>>({
		[ImageKeys.vite]: '',
		[ImageKeys.react]: '',
	});

	useEffect(() => {
		const fetchImages = async () => {
			const newImageSources = {} as Record<ImageKeys, string>;
			for (const key of Object.keys(ImageMap) as unknown as ImageKeys[]) {
				newImageSources[key] = await getImageUrl(ImageMap[key]);
			}
			setImageSources(newImageSources);
		}
		fetchImages();
	}, []);

	return <ImageContext.Provider value={{ imageSources }}>{children}</ImageContext.Provider>;
};

export { ImageContext, ImageProvider}