import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ImageProvider } from './imageProvider';
import { MemoryRouter as Router } from 'react-router-dom';
import { StateProvider } from './StateProvider';

export const vscodeApi = acquireVsCodeApi<number>();

export function createRootElement() {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <StateProvider>
        <Router>
          <ImageProvider>
            <App />
          </ImageProvider>
        </Router>
      </StateProvider>
    </React.StrictMode>,
  );
}
