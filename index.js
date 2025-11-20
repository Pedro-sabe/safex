require('dotenv').config();

const express = require('express');
const axios = require('axios');
const { OpenAI } = require('openai');

const app = express();
app.use(express.json({ limit: '10mb' }));

// === LOG DE DIAGNÓSTICO (aparece no Railway) ===
console.log('=== VARIÁVEIS CARREGADAS ===');
console.log('OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'OK (' + process.env.OPENAI_API_KEY.substring(0, 10) + '...)' : 'FALTANDO');
console.log('ASSISTANT_ID:', process.env.ASSISTANT_ID ? 'OK' : 'FALTANDO');
console.log('WHATSAPP_TOKEN:', process.env.WHATSAPP_TOKEN ? 'OK' : 'FALTANDO');
console.log('PHONE_NUMBER_ID:', process.env.PHONE_NUMBER_ID ? 'OK' : 'FALTANDO');
console.log('VERIFY_TOKEN:', process.env.VERIFY_TOKEN ? 'OK' : 'FALTANDO');
console.log('==============================');

// Proteção contra falta de variáveis críticas
if (!process.env.OPENAI_API_KEY) {
  console.error('ERRO CRÍTICO: OPENAI_API_KEY não encontrada. Abortando.');
  process.exit(1);
}

// Inicializa OpenAI com fallback
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const ASSISTANT_ID = process.env.ASSISTANT_ID;
const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID;

// Mapa de threads por número
const threads = new Map();

// Verificação do webhook
app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) {
    res.send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
});

// Recebe mensagens do WhatsApp
app.post('/webhook', async (req, res) => {
  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message || !message.text?.body) return res.sendStatus(200);

    const from = message.from;
    const msg = message.text.body.trim();

    let threadId = threads.get(from);
    if (!threadId) {
      const thread = await openai.beta.threads.create();
      threadId = thread.id;
      threads.set(from, threadId);
    }

    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: msg
    });

    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: ASSISTANT_ID
    });

    // Polling até completar
    let runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
    while (!["completed", "failed", "cancelled", "expired"].includes(runStatus.status)) {
      await new Promise(r => setTimeout(r, 800));
      runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
    }

    if (runStatus.status === "completed") {
      const messages = await openai.beta.threads.messages.list(threadId);
      const reply = messages.data[0].content[0].text.value || "Desculpe, não consegui gerar uma resposta.";

      await axios.post(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`, {
        messaging_product: "whatsapp",
        to: from,
        type: "text",
        text: { body: reply }
      }, {
        headers: { Authorization: `Bearer ${TOKEN}` }
      });
    }
  } catch (e) {
    console.error("Erro no webhook:", e.message);
  }
  res.sendStatus(200);
});

// Porta do Railway (obrigatória!)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SAFEX rodando na porta ${PORT} e 100% ativo!`);
  console.log(`URL pública: https://desirable-connection-production.up.railway.app`);
});
