import React from 'react';
import { createRoot } from 'react-dom/client';

import '@ui/index.css';
import './src/console.css';
import App from './src/App';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
