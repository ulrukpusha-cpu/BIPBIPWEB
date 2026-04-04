/**
 * Module MTN MoMo - Collection API.
 * Usage: require('./services/mtn-momo')
 */
const { getConfig } = require('./config');
const { getAccessToken, clearTokenCache } = require('./auth');
const { requestToPay, getTransactionStatus } = require('./api');

module.exports = {
    getConfig,
    getAccessToken,
    clearTokenCache,
    requestToPay,
    getTransactionStatus
};
