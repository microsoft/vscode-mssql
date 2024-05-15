import { PrimaryButton } from "@fluentui/react";
import { useContext } from "react";
import { ImageContext, ImageKeys } from '../imageProvider';
import { rpc } from "../utils/rpc";

export const WelcomePage = () => {
	const imageSources = useContext(ImageContext);
	return (
		<>
        <div>
          <a href="https://vitejs.dev" target="_blank">
            <img src={imageSources?.imageSources[ImageKeys.vite]} className="logo" alt="Vite logo" />
          </a>
          <a href="https://react.dev" target="_blank">
            <img src={imageSources?.imageSources[ImageKeys.react]} className="logo react" alt="React logo" />
          </a>
        </div>
        <h1>Vite + React</h1>
        <div className="card">
          <PrimaryButton
            text='Click me'
            onClick={() => {
              rpc.call('showDemoAlert', 'Hello from React!');
            }}
          />
        </div>
        <p className="read-the-docs">
          Click on the Vite and React logos to learn more
        </p>
      </>
	);
}