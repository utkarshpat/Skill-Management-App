import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ThemeProvider } from './Theme';
import { BrowserRouter } from 'react-router';
import './styles.css';
import './ui.css';
import './theme.css';
import './workspace-pages.css';
import './sidebar-navigation.css';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><ThemeProvider><App /></ThemeProvider></BrowserRouter></React.StrictMode>);
