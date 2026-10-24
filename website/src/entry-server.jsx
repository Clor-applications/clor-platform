import React from 'react';
import { renderToString } from 'react-dom/server';
import App from './App.jsx';
import { headFor, ROUTES } from './routes.jsx';

export { ROUTES };
export function render(path) {
  return { html: renderToString(<App path={path} />), head: headFor(path) };
}
