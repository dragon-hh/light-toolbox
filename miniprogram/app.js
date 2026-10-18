const config = require('./config');
App({
  onLaunch() {
    const account = wx.getAccountInfoSync();
    if (config.transport === 'cloud') {
      if (!config.cloudEnv || !config.cloudFunction) throw new Error('Cloud environment and function are required.');
      require('./utils/cloud-api').init();
    }
    if (account.miniProgram.envVersion === 'release' && (config.mode !== 'production' || (config.transport !== 'cloud' && !/^https:\/\//.test(config.apiBase)))) {
      throw new Error('Release requires production mode and a cloud backend or HTTPS API.');
    }
    console.info('[LIGHT] app.start', { mode: config.mode, version: account.miniProgram.version });
  },
  onError(message) { console.error('[LIGHT] app.error', message); },
  onUnhandledRejection(event) { console.error('[LIGHT] unhandled', event.reason); }
});
