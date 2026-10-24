import './styles.css';
import { cssVariables } from '../shared/tokens';
import { startApp } from './app';

// CSSOM setProperty is allowed under the strict CSP, unlike inline style attributes.
const rootStyle = document.documentElement.style;
for (const [name, value] of Object.entries(cssVariables())) {
  rootStyle.setProperty(name, value);
}

const app = document.getElementById('app');
const polite = document.getElementById('live-polite');
const assertive = document.getElementById('live-assertive');
if (app && polite && assertive) {
  startApp(app, { polite, assertive });
}
