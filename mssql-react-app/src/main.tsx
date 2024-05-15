import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { ImageProvider } from './imageProvider.tsx';
import { MemoryRouter as Router} from 'react-router-dom';


export const vscodeApi = acquireVsCodeApi<number>();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router>
      <ImageProvider>
        <App />
      </ImageProvider>
    </Router>
  </React.StrictMode>,
)
