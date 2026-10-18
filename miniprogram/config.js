// Production build. Prices and paid entitlements are controlled by CloudBase.
// Refund acceptance is deferred by the owner; this is not an acceptance flag.
module.exports = {
  transport: 'cloud', mode: 'production', apiBase: 'http://127.0.0.1:8787',
  cloudEnv: 'cloud1-6gjewz7jf1fbf260', cloudFunction: 'lightToolbox'
};
