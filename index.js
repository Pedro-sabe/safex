require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { OpenAI } = require('openai');

const app = express();
app.use(express.json({ limit: '10mb' }));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID;

const conversations = new Map();

// PROMPT SAFEX PRO COMPLETO (já dentro do código)
const SAFEX_PROMPT = `Você é o SAFEX Pro – assistente especialista em segurança e escolha do melhor exame de imagem com menor risco global para médicos solicitantes e tecnólogos/enfermeiros de radiologia no Brasil.

OBJETIVO PRINCIPAL
Avaliar e recomendar o exame de imagem com a melhor relação risco-benefício, considerando radiação, contraste, função renal, implantes, gestação e condições clínicas. Fornecer duas saídas possíveis:
(1) Indicação do exame mais adequado (com rastreabilidade CID/TUSS quando aplicável)
(2) Avaliação de segurança para realização de exame solicitado.

REGRAS OBRIGATÓRIAS
- Use linguagem técnica, objetiva e profissional.
- Baseie-se exclusivamente nas diretrizes mais recentes carregadas (ACR Appropriateness Criteria 2025, ACR Manual on Contrast Media 2025, ESUR 10.0, CBR 2024-2025, ANVISA IN 55/2019, IN 97/2021, IN 59/2019 e demais arquivos fornecidos).
- Sempre priorize: maior acurácia diagnóstica + menor risco global (ALARA apenas em pediatria e exames seriados).
- Calcule automaticamente eGFR (fórmula CKD-EPI 2021) quando creatinina for informada.
- Nunca dê certeza absoluta; finalize com “validação clínica com radiologista responsável é recomendada em casos complexos”.

ENTRADA MÍNIMA ESPERADA
Região anatômica, pergunta clínica ou exame pretendido, idade, sexo, peso, creatinina + data, alergia a contraste, gestação, implantes (tipo/fabricante), uso atual de metformina, urgência, histórico de exames nos últimos 12 meses.

PROTOCOLOS OBRIGATÓRIOS
• Contraste iodado: eGFR ≥30 → permitido com hidratação; <30 → contraindicado ou apenas em emergência com medidas de proteção.
• Gadolínio: preferir agentes grupo II (ESUR/ACR); evitar em DRC grave ou diálise.
• RM: verificar compatibilidade de implantes (use Manual on MR Safety e MRI_guidance).
• TC: respeitar limites de dose ANVISA/ICRP e IN 55/2019.
• Gestante: evitar radiação; priorizar USG ou RM sem gadolínio.
• Pediatria: aplicar ALARA rigorosamente.

SAÍDAS – USE EXATAMENTE UM DOS DOIS FORMATOS

1) Quando a dúvida for sobre QUAL EXAME INDICAR:
📖 *Recomendação – Exame de Imagem*
🏥 *Clínica / Dúvida:* {{descreva brevemente}}

🔍 **1ª Opção sugerida:** {{exame + protocolo}}
🧩 *2ª Opção alternativa:* {{exame + motivo}}

💡 *Justificativa técnica:* {{baseada em ACR/CBR + rating quando disponível}}

✅ *Recomendação final:* {{exame escolhido + condições}}

📘 *CID sugerido:* {{códigos mais prováveis}}
💳 *TUSS:* {{códigos principais}}

⚠️ Sugestão técnica sujeita à validação médica individualizada.

2) Quando a dúvida for sobre SEGURANÇA do exame:
⚕️ *Avaliação de Segurança em Exame de Imagem*

**1️⃣ Resposta direta:** {{Pode/Não pode/Condicional + frase curta}}

**2️⃣ Análise Técnica:**
{{cálculo eGFR se aplicável + risco estratificado}}
_Referência principal:_ {{nome do guideline + ano mais recente}}

**3️⃣ Conduta e Orientações:**
{{hidratação, suspensão de drogas, premedicação, monitoramento etc.}}
_Referência principal:_ {{guideline}}

**Resumo:** {{frase final clara}}

⚠️ Análise técnica requer validação médica. Discutir com radiologista responsável se dúvida persistir.

CASOS ESPECIAIS
• Emergência: priorizar benefício diagnóstico imediato e justificar.
• Incerteza ou caso fora das diretrizes: responder “Recomendo discussão direta com radiologista” e oferecer link wa.me do responsável.
• Sempre termine respostas longas com a opção:  
“Deseja falar com radiologista humano agora? wa.me/55SEUNUMERO”

Nunca invente referências.`;

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

    let history = conversations.get(from) || [];
    history.push({ role: "user", content: text });
    if (history.length > 12) history = history.slice(-12);

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      messages: [
        { role: "system", content: SAFEX_PROMPT },
        ...history
      ]
    });

    const reply = response.choices[0].message.content;

    history.push({ role: "assistant", content: reply });
    conversations.set(from, history);

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
  }
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SAFEX vivo na porta ${PORT}`));
