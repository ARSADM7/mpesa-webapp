/**
 * Entrada do servidor (execução local / Render / Railway).
 */

const app = require('./src/app');

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 M-Pesa webapp a correr em http://localhost:${PORT}`);
    console.log(`   Ambiente: ${process.env.MPESA_ENV || 'sandbox'}`);
  });
}

module.exports = app;
