import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import {ToastHost} from './ToastHost';
import { ThemeProvider } from './Theme';
import { WorkspaceRecovery } from './WorkspaceRecovery';
import { BrowserRouter } from 'react-router';
import './styles.css';
import './ui.css';
import './theme.css';
import './workspace-pages.css';
import './sidebar-navigation.css';
import './profile-page.css';
import './ui-kit.css';
import './toast.css';
import './modern-ui.css';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><WorkspaceRecovery><BrowserRouter><ThemeProvider><App /><ToastHost/></ThemeProvider></BrowserRouter></WorkspaceRecovery></React.StrictMode>);

import './effective-access.css';
