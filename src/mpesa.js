/**
 * Cliente da Open API do M-Pesa Moçambique (Vodacom).
 *
 * Autenticação: a API Key é criptografada com a Public Key (RSA PKCS1)
 * e enviada como Bearer token em cada pedido.
 *
 * Documentação oficial: https://developer.mpesa.vm.co.mz/
 */

const crypto = require('crypto');
const https = require('https');
const axios = require('axios');

const HOSTS = {
  sandbox: 'api.sandbox.vm.co.mz',
  live: 'api.vm.co.mz',
};

const PORT = 18352;
const MARKET = 'vodacomMZN';

// Códigos de resposta oficiais da API M-Pesa
const ERROS_INS = {
  'INS-0': 'Pedido processado com sucesso',
  'INS-1': 'Erro interno',
  'INS-2': 'API Key inválida',
  'INS-4': 'Utilizador inactivo',
  'INS-5': 'Transacção cancelada pelo cliente',
  'INS-6': 'Transacção falhou',
  'INS-9': 'Timeout do pedido',
  'INS-10': 'Transacção duplicada',
  'INS-13': 'Shortcode inválido (verifique o Service Provider Code)',
  'INS-14': 'Referência inválida',
  'INS-15': 'Valor/Amount inválido',
  'INS-16': 'Sistema temporariamente sobrecarregado',
  'INS-17': 'Referência de transacção inválida (entre 1 e 20 caracteres)',
  'INS-18': 'TransactionID inválido',
  'INS-19': 'ThirdPartyReference inválido',
  'INS-20': 'Parâmetros em falta',
  'INS-21': 'Validação de parâmetros falhou',
  'INS-22': 'Tipo de operação inválido',
  'INS-23': 'Estado desconhecido — contacte o suporte M-Pesa',
  'INS-24': 'InitiatorIdentifier inválido',
  'INS-25': 'SecurityCredential inválido',
  'INS-26': 'Não autorizado',
  'INS-2001': 'Erro de autenticação do iniciador',
  'INS-2002': 'Recetor inválido',
  'INS-2006': 'Saldo insuficiente',
  'INS-2051': 'Número inválido',
  'INS-996': 'Conta do cliente não está activa',
};

class MpesaClient {
  constructor(config = {}) {
    this.apiKey = config.apiKey;
    this.publicKey = config.publicKey;
    this.serviceProviderCode = config.serviceProviderCode || '171717';
    this.origin = config.origin || 'developer.mpesa.vm.co.mz';
    this.country = config.country || 'MOZ';
    this.currency = config.currency || 'MZN';
    this.env = config.env === 'live' ? 'live' : 'sandbox';
    // No sandbox o certificado pode não ser validável; produção é sempre estrita.
    this.strictSSL =
      this.env === 'live' ? true : config.strictSSL !== undefined ? config.strictSSL : false;

    if (!this.apiKey || !this.publicKey) {
      throw new Error('MPESA_API_KEY e MPESA_PUBLIC_KEY são obrigatórios');
    }

    this.http = axios.create({
      baseURL: `https://${HOSTS[this.env]}:${PORT}`,
      timeout: 60000,
      headers: {
        'Content-Type': 'application/json',
        Origin: this.origin,
        // O WAF (Imperva) da Vodacom bloqueia pedidos sem User-Agent de navegador
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: this.strictSSL }),
      maxRedirects: 0,
    });

    // Cookies do desafio do WAF (Incapsula). Ao receber Set-Cookie,
    // guardamos e reenviamos nos pedidos seguintes.
    this.cookies = {};
  }

  _cabecalhoCookie() {
    const pares = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`);
    return pares.length ? pares.join('; ') : undefined;
  }

  /**
   * Gera o Bearer token: criptografa a API Key com a Public Key (RSA PKCS1).
   */
  gerarBearerToken() {
    const pem = [
      '-----BEGIN PUBLIC KEY-----',
      ...(this.publicKey.match(/.{1,64}/g) || []),
      '-----END PUBLIC KEY-----',
    ].join('\n');

    const encrypted = crypto.publicEncrypt(
      { key: pem, padding: crypto.constants.RSA_PKCS1_PADDING },
      Buffer.from(this.apiKey, 'utf8')
    );

    return encrypted.toString('base64');
  }

  /**
   * ID único de conversação (máx. 36 caracteres).
   */
  novoConversationID() {
    return `CP-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`.slice(0, 36);
  }

  async pedir(path, body, _reinternar = true) {
    const cabecalhos = { Authorization: `Bearer ${this.gerarBearerToken()}` };
    const cookie = this._cabecalhoCookie();
    if (cookie) cabecalhos.Cookie = cookie;

    try {
      const resposta = await this.http.post(path, body, { headers: cabecalhos });

      // Guarda cookies de sessão do WAF para os próximos pedidos
      const setCookies = resposta.headers['set-cookie'] || [];
      for (const sc of setCookies) {
        const [par] = sc.split(';');
        const idx = par.indexOf('=');
        if (idx > 0) this.cookies[par.slice(0, idx).trim()] = par.slice(idx + 1).trim();
      }

      const data = resposta.data || {};
      const codigo = data.output_ResponseCode || '';
      return {
        sucesso: codigo === 'INS-0',
        codigo,
        mensagem: data.output_ResponseDesc || ERROS_INS[codigo] || 'Sem descrição da API',
        transactionId: data.output_TransactionID || null,
        conversationId: data.output_ConversationID || null,
        dadosBrutos: data,
      };
    } catch (err) {
      if (err.response) {
        // Guarda cookies mesmo em erro (o desafio do WAF envia Set-Cookie com o bloqueio)
        const setCookies = err.response.headers['set-cookie'] || [];
        for (const sc of setCookies) {
          const [par] = sc.split(';');
          const idx = par.indexOf('=');
          if (idx > 0) this.cookies[par.slice(0, idx).trim()] = par.slice(idx + 1).trim();
        }

        const status = err.response.status;
        // 403/400 do WAF (Imperva/Incapsula): reinternamos uma vez já com cookies
        const wafBlock = status === 403 || status === 400;
        if (wafBlock && _reinternar) {
          await new Promise((r) => setTimeout(r, 1500));
          return this.pedir(path, body, false);
        }

        const data = err.response.data && typeof err.response.data === 'object' ? err.response.data : {};
        const codigo = data.output_ResponseCode || `HTTP_${status}`;
        return {
          sucesso: false,
          codigo,
          mensagem:
            data.output_ResponseDesc ||
            ERROS_INS[data.output_ResponseCode] ||
            (wafBlock
              ? `Bloqueado pelo firewall da Vodacom (WAF) — HTTP ${status}. Se persistir, solicite whitelist do IP do servidor ao suporte M-Pesa.`
              : `A API devolveu HTTP ${status}`),
          transactionId: null,
          conversationId: null,
          dadosBrutos: null,
        };
      }
      return {
        sucesso: false,
        codigo: 'SEM_CONEXAO',
        mensagem: `Falha ao contactar a API M-Pesa: ${err.message}`,
        transactionId: null,
        conversationId: null,
        dadosBrutos: null,
      };
    }
  }

  /**
   * C2B — cobra um pagamento ao cliente (o número recebe o prompt para inserir PIN).
   * @param {object} p - { msisdn, valor, referencia, descricao }
   */
  async c2b(p) {
    const corpo = {
      input_TransactionReference: p.referencia,
      input_CustomerMSISDN: p.msisdn,
      input_Amount: String(p.valor),
      input_ThirdPartyConversationID: this.novoConversationID(),
      input_ServiceProviderCode: this.serviceProviderCode,
      input_Country: this.country,
      input_Currency: this.currency,
      input_PurchasedItemsDesc: p.descricao || 'Pagamento webapp',
    };
    return this.pedir(`/ipg/v2/${MARKET}/c2bPayment/singleStage/`, corpo);
  }

  /**
   * Consulta o estado de uma transacção pelo TransactionID ou referência própria.
   */
  async consultarStatus(referencia) {
    const corpo = {
      input_QueryReference: referencia,
      input_ServiceProviderCode: this.serviceProviderCode,
      input_ThirdPartyConversationID: this.novoConversationID(),
      input_Country: this.country,
    };
    return this.pedir(`/ipg/v2/${MARKET}/queryTransactionStatus/`, corpo);
  }
}

module.exports = { MpesaClient, ERROS_INS };
