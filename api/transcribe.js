const Busboy = require("busboy");

const MAX_AUDIO_BYTES = Number(process.env.MAX_AUDIO_BYTES || 25 * 1024 * 1024);
const GROQ_STT_MODEL = process.env.GROQ_STT_MODEL || "whisper-large-v3-turbo";
const GROQ_TEXT_MODEL = process.env.GROQ_TEXT_MODEL || "llama-3.3-70b-versatile";

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({
      headers: req.headers,
      limits: {
        files: 1,
        fileSize: MAX_AUDIO_BYTES,
        fields: 8
      }
    });

    const fields = {};
    let audioFile = null;
    let rejected = false;

    function rejectOnce(error) {
      if (rejected) return;
      rejected = true;
      reject(error);
    }

    busboy.on("field", (name, value) => {
      fields[name] = value;
    });

    busboy.on("file", (name, file, info) => {
      const chunks = [];
      let size = 0;

      file.on("data", chunk => {
        size += chunk.length;
        chunks.push(chunk);
      });

      file.on("limit", () => {
        rejectOnce(new Error("O áudio ficou grande demais. Grave até 2 minutos."));
      });

      file.on("end", () => {
        if (rejected) return;

        audioFile = {
          fieldName: name,
          filename: info.filename || "audio.webm",
          mimeType: info.mimeType || "audio/webm",
          buffer: Buffer.concat(chunks),
          size
        };
      });
    });

    busboy.on("error", rejectOnce);

    busboy.on("finish", () => {
      if (rejected) return;
      resolve({ fields, audioFile });
    });

    req.pipe(busboy);
  });
}

async function groqFetch(path, options) {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    const error = new Error("GROQ_API_KEY não configurada na Vercel.");
    error.statusCode = 500;
    throw error;
  }

  const response = await fetch(`https://api.groq.com/openai/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(options.headers || {})
    }
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const errorMessage =
      typeof payload === "string"
        ? payload
        : payload?.error?.message || "Erro na API da Groq.";

    const error = new Error(errorMessage);
    error.statusCode = response.status;
    throw error;
  }

  return payload;
}

async function transcribeAudio(audioFile) {
  const formData = new FormData();
  const blob = new Blob([audioFile.buffer], { type: audioFile.mimeType });

  formData.append("file", blob, audioFile.filename);
  formData.append("model", GROQ_STT_MODEL);
  formData.append("language", "pt");
  formData.append("response_format", "json");
  formData.append("temperature", "0");
  formData.append("prompt", "Áudio em português do Brasil, de um exercício de reflexão emocional.");

  const result = await groqFetch("/audio/transcriptions", {
    method: "POST",
    body: formData
  });

  return result.text || "";
}

async function organizeText({ transcription, question }) {
  const systemPrompt = `
Você organiza transcrições de áudio para um exercício de reflexão emocional.

Regras:
- Não invente informações.
- Não faça diagnóstico.
- Não dê conselho terapêutico.
- Preserve o sentido da fala.
- Corrija gramática, pontuação e repetição natural da fala.
- Use primeira pessoa.
- Organize em frases curtas.
- Use emojis com moderação para melhorar a visualização.
- Retorne apenas o texto final, sem comentários.
`.trim();

  const userPrompt = `
Pergunta do app:
${question || "Resposta escrita"}

Transcrição bruta:
${transcription}

Transforme isso em uma resposta organizada, fiel e clara.
`.trim();

  const result = await groqFetch("/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: GROQ_TEXT_MODEL,
      temperature: 0.2,
      max_tokens: 700,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    })
  });

  return result.choices?.[0]?.message?.content?.trim() || transcription;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido." });
  }

  try {
    const contentType = req.headers["content-type"] || "";

    if (!contentType.includes("multipart/form-data")) {
      return res.status(400).json({ error: "Envie o áudio como multipart/form-data." });
    }

    const { fields, audioFile } = await parseMultipart(req);

    if (!audioFile || !audioFile.buffer?.length) {
      return res.status(400).json({ error: "Nenhum áudio recebido." });
    }

    if (audioFile.size > MAX_AUDIO_BYTES) {
      return res.status(413).json({ error: "O áudio ficou grande demais. Grave até 2 minutos." });
    }

    const transcription = await transcribeAudio(audioFile);

    if (!transcription.trim()) {
      return res.status(422).json({ error: "Não consegui identificar fala no áudio." });
    }

    const organizedText = await organizeText({
      transcription,
      question: fields.question || ""
    });

    return res.status(200).json({
      text: organizedText,
      rawTranscription: transcription
    });
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({
      error: error.message || "Erro ao processar áudio."
    });
  }
};
