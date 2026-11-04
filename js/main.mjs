import { CLIENT_ID } from '../config.js';
import { startApp } from './app.mjs';

startApp({ clientId: CLIENT_ID }).catch(error => {
  const notice = document.getElementById('notice');
  notice.hidden = false; notice.textContent = error.message || '起動できませんでした。もう一度開いてください。';
});
