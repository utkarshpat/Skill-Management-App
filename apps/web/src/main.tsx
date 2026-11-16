import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ToastHost } from './ToastHost';
import { ThemeProvider } from './Theme';
import { WorkspaceRecovery } from './WorkspaceRecovery';
import { ClientErrorBoundary } from './ClientErrorBoundary';
import { installClientDiagnostics } from './client-diagnostics';
import { BrowserRouter } from 'react-router';
import { installDeploymentRecovery } from './deployment-recovery';
import './styles.css';
import './ui.css';
import './theme.css';
import './workspace-pages.css';
import './sidebar-navigation.css';
import './profile-page.css';
import './ui-kit.css';
import './toast.css';
import './modern-ui.css';

if (import.meta.env.PROD) installDeploymentRecovery();
installClientDiagnostics();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WorkspaceRecovery>
      <BrowserRouter>
        <ThemeProvider>
          <ClientErrorBoundary>
            <App />
            <ToastHost />
          </ClientErrorBoundary>
        </ThemeProvider>
      </BrowserRouter>
    </WorkspaceRecovery>
  </React.StrictMode>,
);

import './effective-access.css';
import './business/business-administration.css';
