/**
 * Entrada serverless (Vercel).
 * As variáveis MPESA_* devem ser configuradas nas Environment Variables do projecto.
 */

const app = require('../src/app');

module.exports = app;
