/**
 * Rotas de pagamento.
 *
 *  POST /api/pagamento                  — inicia cobrança C2B (prompt USSD no número)
 *  GET  /api/pagamento/:ref/status      — consulta o estado junto à API M-Pesa
 *  GET  /api/saude                      — healthcheck
 */

const express = require('express');
const { MpesaClient } = require('../mpesa');

const router = express.Router();

const mpesa = new MpesaClient({
  apiKey: process.env.MPESA_API_KEY,
  publicKey: process.env.MPESA_PUBLIC_KEY,
  serviceProviderCode: process.env.MPESA_SERVICE_PROVIDER_CODE,
  origin: process.env.MPESA_ORIGIN,
  country: process.env.MPESA_COUNTRY,
  currency: process.env.MPESA_CURRENCY,
  env: process.env.MPESA_ENV,
});

/**
 * Normaliza números moçambicanos para o formato internacional sem '+':
 *   844744484        -> 258844744484
 *   0844744484       -> 258844744484
 *   +258 84 744 4484 -> 258844744484
 */
function normalizarNumero(entrada) {
  if (!entrada || typeof entrada !== 'string') return null;
  let n = entrada.replace(/[\s\-()+.]/g, '');
  if (n.startsWith('00258')) n = n.slice(2);
  if (n.startsWith('258')) return /^\d{12}$/.test(n) ? n : null;
  if (n.startsWith('0')) n = n.slice(1);
  return /^8[2-7]\d{7}$/.test(n) ? `258${n}` : null;
}

/**
 * Referência própria da transacção — a API exige entre 1 e 20 caracteres.
 */
function novaReferencia() {
  return `REF${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1296).toString(36).toUpperCase()}`.slice(0, 20);
}

router.get('/saude', (_req, res) => {
  res.json({ status: 'ok', ambiente: process.env.MPESA_ENV || 'sandbox', hora: new Date().toISOString() });
});

router.post('/pagamento', async (req, res) => {
  const { numero, valor, descricao } = req.body || {};

  // --- Validação de entrada ---
  const erros = [];
  const msisdn = normalizarNumero(numero);
  if (!msisdn) {
    erros.push({ campo: 'numero', problema: 'Número inválido. Use formato 8XXXXXXXX ou 2588XXXXXXXX.' });
  }

  const valorNum = Number(valor);
  if (!Number.isFinite(valorNum) || valorNum < 1) {
    erros.push({ campo: 'valor', problema: 'O valor deve ser um número maior ou igual a 1 MZN.' });
  } else if (valorNum > 500000) {
    erros.push({ campo: 'valor', problema: 'O valor excede o limite de 500.000 MZN.' });
  }

  if (erros.length) {
    return res.status(400).json({
      error: { code: 'VALIDACAO', message: 'Dados inválidos.', detalhes: erros },
    });
  }

  const referencia = novaReferencia();

  // --- Chamada à API M-Pesa (C2B) ---
  const resultado = await mpesa.c2b({
    msisdn,
    valor: valorNum,
    referencia,
    descricao: typeof descricao === 'string' && descricao.trim() ? descricao.trim().slice(0, 100) : undefined,
  });

  console.log(`[C2B] ref=${referencia} msisdn=${msisdn} valor=${valorNum} -> ${resultado.codigo} ${resultado.mensagem}`);

  if (!resultado.sucesso) {
    return res.status(502).json({
      error: {
        code: resultado.codigo,
        message: resultado.mensagem,
        transactionId: resultado.transactionId,
        conversationId: resultado.conversationId,
      },
      referencia,
    });
  }

  return res.status(201).json({
    data: {
      referencia,
      estado: 'aceito',
      transactionId: resultado.transactionId,
      conversationId: resultado.conversationId,
      numero: msisdn,
      valor: valorNum,
      mensagem: 'Pedido enviado. O cliente deve confirmar com o PIN no telefone.',
      consultaStatus: `/api/pagamento/${referencia}/status`,
    },
  });
});

router.get('/pagamento/:referencia/status', async (req, res) => {
  const { referencia } = req.params;

  if (!/^[A-Za-z0-9_-]{1,36}$/.test(referencia)) {
    return res.status(400).json({
      error: { code: 'VALIDACAO', message: 'Referência inválida.' },
    });
  }

  const r = await mpesa.consultarStatus(referencia);

  console.log(`[QUERY] ref=${referencia} -> ${r.codigo} ${r.mensagem}`);

  if (!r.sucesso) {
    // INS-9 / timeout ainda pode estar em curso -> devolvemos "pendente"
    const pendente = ['INS-9', 'SEM_CONEXAO'].includes(r.codigo);
    return res.status(pendente ? 200 : 404).json({
      data: {
        referencia,
        estado: pendente ? 'pendente' : 'desconhecido',
        codigo: r.codigo,
        mensagem: r.mensagem,
        transactionId: r.transactionId,
      },
    });
  }

  // output_TransactionState: S = Sucesso, F = Falhou, P = Pendente
  const estadoBruto = (r.dadosBrutos && r.dadosBrutos.output_TransactionState) || '';
  const estado =
    estadoBruto === 'S' ? 'sucesso' : estadoBruto === 'F' ? 'falhou' : 'pendente';

  return res.json({
    data: {
      referencia,
      estado,
      transactionId: r.transactionId,
      conversationId: r.conversationId,
      mensagem: r.mensagem,
      montante: r.dadosBrutos ? r.dadosBrutos.output_Amount : undefined,
    },
  });
});

module.exports = { router };
