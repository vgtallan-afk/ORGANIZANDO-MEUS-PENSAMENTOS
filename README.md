# Organizando meus pensamentos — versão 2.1 com áudio + Groq

## Como usar na Vercel

1. Suba estes arquivos para um repositório no GitHub.
2. Importe o repositório na Vercel.
3. Em `Project Settings > Environment Variables`, adicione:

```env
GROQ_API_KEY=sua_chave_da_groq
```

4. Faça o deploy.

A chave da Groq fica segura no backend em `api/transcribe.js`.
O HTML chama apenas `/api/transcribe`.

## Limite configurado

O front limita cada gravação a 2 minutos.
O backend também limita o arquivo a 25 MB por padrão.

## Variáveis opcionais

```env
GROQ_STT_MODEL=whisper-large-v3-turbo
GROQ_TEXT_MODEL=llama-3.3-70b-versatile
MAX_AUDIO_BYTES=26214400
```
