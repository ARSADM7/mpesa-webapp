/**
 * Express app — montagem das rotas e ficheiros estáticos.
 * Separado do server.js para permitir deploy serverless (Vercel).
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const { router } = require('./routes/pagamentos');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', router);

// 404 para rotas desconhecidas da API
app.use('/api', (_req, res) => {
  res.status(404).json({ error: { code: 'NAO_ENCONTRADO', message: 'Rota não existe.' } });
});

// Erro inesperado
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[ERRO]', err);
  res.status(500).json({
    error: { code: 'ERRO_INTERNO', message: 'Ocorreu um erro inesperado no servidor.' },
  });
});

module.exports = app;
