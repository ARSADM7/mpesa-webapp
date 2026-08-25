# M-Pesa Webapp Moçambique 💸

Webapp completo de pagamentos **M-Pesa (Vodacom Moçambique)** usando a Open API — operação **C2B** (receber pagamentos).

- Backend: Node.js + Express (sem SDKs externos, só axios)
- Frontend: HTML/CSS/JS puro, responsivo (funciona em PWA e WebView Android)
- Autenticação: API Key criptografada com RSA PKCS1 → Bearer token

## 🌐 Deployments

| Serviço | URL | Função |
|---|---|---|
| **Vercel (produção)** | https://mpesa-webapp.vercel.app | API + webapp completos |
| **GitHub Pages** | https://arsadm7.github.io/mpesa-webapp/ | Interface ligada à API da Vercel |
| **Repositório** | https://github.com/ARSADM7/mpesa-webapp | Código-fonte |

Variáveis de ambiente configuradas na Vercel: `MPESA_ENV`, `MPESA_API_KEY`, `MPESA_PUBLIC_KEY`, `MPESA_SERVICE_PROVIDER_CODE`, `MPESA_ORIGIN`, `MPESA_COUNTRY`, `MPESA_CURRENCY`.

---

## ⚠️ Situação actual dos testes (IMPORTANTE)

O sandbox (`api.sandbox.vm.co.mz:18352`) está protegido pelo firewall **Imperva/Incapsula**, que actualmente **bloqueia chamadas API vindas de IPs não autorizados** (exige execução de JavaScript de navegador). Isto é um problema conhecido e generalizado — não é um erro no código.

**Diagnóstico feito neste projecto:**

| Pedido | Resultado |
|---|---|
| Token curto / sem auth | ✅ Passa o WAF (chega ao nginx) |
| Token real RSA (684 chars) sem cookies | ❌ 403 Imperva |
| Node.js directo | ❌ 403 (fingerprint TLS OpenSSL) |
| Com cookies Incapsula | Passa WAF → 400 (desafio JS pendente) |

**Solução oficial**: solicitar à Vodacom a **whitelist do IP do servidor**.

### Modelo de e-mail para enviar

> **Para:** M-Pesa.business@vm.co.mz
> **Assunto:** Whitelist de IP para acesso ao Sandbox Open API — {Nome/Empresa}
>
> Saudações, equipa M-Pesa,
>
> Estou a desenvolver a integração com a Open API no ambiente sandbox e as minhas chamadas estão a ser bloqueadas pelo firewall (Imperva) com HTTP 403.
>
> Dados:
> - IP público do servidor: `41.220.201.235`
> - Ambiente: sandbox (`api.sandbox.vm.co.mz`)
> - Operação: C2B Payment
>
> Solicito a liberação/whitelist deste IP para poder concluir os testes de integração.
>
> Obrigado.

*(Depois de receberem confirmação, os testes funcionam sem alterar código.)*

---

## Estrutura

```
mpesa-webapp/
├── .env                  # credenciais (NÃO commitar)
├── .env.example          # modelo
├── package.json
├── server.js             # entrada local
├── api/index.js          # entrada serverless (Vercel)
├── vercel.json           # config deploy
├── src/
│   ├── app.js            # Express + rotas + estáticos
│   ├── mpesa.js          # cliente Open API M-Pesa (auth RSA, C2B, Query)
│   └── routes/pagamentos.js
└── public/index.html     # webapp
```

## Instalação e execução

```bash
npm install
npm start            # http://localhost:3000
```

Configure o `.env` (copie de `.env.example`):

```env
MPESA_ENV=sandbox
MPESA_API_KEY=...
MPESA_PUBLIC_KEY=...
MPESA_SERVICE_PROVIDER_CODE=171717
MPESA_ORIGIN=developer.mpesa.vm.co.mz
```

> A porta 3000 estava ocupada nesta máquina; use `PORT=3001` se necessário.

## Endpoints

### `GET /api/saude`
Healthcheck.
```json
{ "status": "ok", "ambiente": "sandbox", "hora": "..." }
```

### `POST /api/pagamento`

Inicia cobrança C2B — o número recebe prompt USSD para inserir PIN.

**Corpo:**
```json
{ "numero": "844744484", "valor": 10, "descricao": "Pedido #123" }
```

Formatos aceites: `844744484`, `0844744484`, `+258844744484`, `258844744484`.

**Resposta 201:**
```json
{
  "data": {
    "referencia": "REFMT8EFQHDSK",
    "estado": "aceito",
    "transactionId": "...",
    "conversationId": "...",
    "numero": "258844744484",
    "valor": 10,
    "consultaStatus": "/api/pagamento/REFMT8EFQHDSK/status"
  }
}
```

**Erros:** `400 VALIDACAO` (dados inválidos), `502` com código INS da API.

### `GET /api/pagamento/:referencia/status`

Consulta estado junto à API M-Pesa.

```json
{ "data": { "referencia": "...", "estado": "sucesso|falhou|pendente", "transactionId": "..." } }
```

`output_TransactionState`: `S`=sucesso, `F`=falhou, `P`=pendente.

## Códigos de erro tratados

INS-0 ok · INS-5 cancelado pelo cliente · INS-6 falhou · INS-10 duplicado · INS-13 shortcode inválido · INS-15 valor inválido · INS-2006 saldo insuficiente · INS-2051 número inválido — lista completa em `src/mpesa.js`.

## Produção

1. Concluir testes no sandbox (após whitelist do IP)
2. Enviar documentação legal para `M-Pesa.business@vm.co.mz` (checklist pessoas colectivas)
3. Assinar contrato e abrir conta empresa M-Pesa → recebem chaves de produção
4. No `.env`: `MPENA_ENV=live`, novas chaves; host muda automaticamente para `api.vm.co.mz`

## Deploy

- **Vercel**: já incluído (`vercel.json` + `api/index.js`). Configure as variáveis `MPESA_*` no dashboard antes do primeiro deploy. Nota: IPs de datacenter podem também ser bloqueados pelo WAF da Vodacom — se acontecer, forneça o IP de saída do serviço ao suporte ou use um pequeno VPS com IP fixo.
- **Render/Railway/VPS**: `npm start` respeita `process.env.PORT`.

## Segurança

- Credenciais apenas em `.env` (no `.gitignore`) ou env vars da plataforma
- Nunca coloque a API Key no app Android/PWA — todas as chamadas passam por este backend
- Em produção adicione HTTPS + rate limiting + autenticação nas rotas
