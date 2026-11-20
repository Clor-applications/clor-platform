import React from 'react';
import { createRoot } from 'react-dom/client';

import '@ui/index.css';
import './src/console.css';
import '@ui/picks.css';
import '@ui/polish.css';
import App from './src/App';
import TipLayer from '@ui/components/ui/TipLayer';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <TipLayer />
  </React.StrictMode>
);
