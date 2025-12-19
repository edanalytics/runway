import { StrictMode } from 'react';
import * as ReactDOM from 'react-dom/client';
import { Landing } from './landing';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <StrictMode>
    <Landing />
  </StrictMode>
);
