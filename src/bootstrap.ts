import { t } from './platform/i18n';
import('./main').catch(error => {
  const app = document.querySelector('#app');
  if (app) app.textContent = t('message.startFailed',{error:String(error)});
});
