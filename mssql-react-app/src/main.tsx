import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { ImageProvider } from './imageProvider.tsx';
import { MemoryRouter as Router } from 'react-router-dom';
import { StateProvider } from './StateProvider.tsx';

export const vscodeApi = acquireVsCodeApi<number>();
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
)
