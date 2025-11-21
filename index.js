require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { OpenAI } = require('openai');

const app = express();
app.use(express.json({ limit: '10mb' }));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ASSISTANT_ID = process.env.ASSISTANT_ID;
const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID;

const threads = new Map();

app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) {
    res.send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message || message.type !== 'text') return res.sendStatus(200);

    const from = message.from;
    const text = message.text.body;

    let threadId = threads.get(from);
    if (!threadId) {
      const thread = await openai.beta.threads.create();
      threadId = thread.id;
      threads.set(from, threadId);
    }

    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: text
    });

    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: ASSISTANT_ID
    });

    // Polling robusto: 60s max, com fallback
    let runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
    let attempts = 0;
    while (attempts < 60) {
      if (runStatus.status === 'completed') break;
      if (['failed', 'cancelled', 'expired'].includes(runStatus.status)) break;
      await new Promise(r => setTimeout(r, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
      attempts++;
    }

    let reply = "Desculpe, estou processando. Tente novamente em 10s.";
    if (runStatus.status === 'completed') {
      const messages = await openai.beta.threads.messages.list(threadId);
      reply = messages.data[0].content[0].text.value;
    }

    await axios.post(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`, {
      messaging_product: "whatsapp",
      to: from,
      type: "text",
      text: { body: reply }
    }, {
      headers: { Authorization: `Bearer ${TOKEN}` }
    });

  } catch (e) {
    console.error("Erro:", e.message);
    // Fallback mensagem de erro
    await axios.post(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`, {
      messaging_product: "whatsapp",
      to: message.from,
      type: "text",
      text: { body: "Erro interno. Tente novamente." }
    }, {
      headers: { Authorization: `Bearer ${TOKEN}` }
    });
  }
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SAFEX vivo na porta ${PORT}`));
