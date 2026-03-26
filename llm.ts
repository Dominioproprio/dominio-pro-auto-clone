/**
 * api/llm.ts — Vercel Serverless Function (proxy para GitHub Models API)
 *
 * Por que esse proxy existe:
 *   O GitHub Models API não permite chamadas cross-origin diretas do browser
 *   (CORS bloqueado). Este endpoint roda server-side no Vercel, faz a chamada
 *   real para models.github.ai e devolve a resposta ao frontend.
 *
 * Segurança:
 *   - O token GitHub (PAT) é lido da variável de ambiente GITHUB_TOKEN
 *   - O frontend NÃO precisa mais armazenar ou enviar o token
 *   - Sem o env var configurado, retorna erro 503 claro
 *
 * Como configurar no Vercel:
 *   1. Abrir o projeto em vercel.com → Settings → Environment Variables
 *   2. Adicionar: GITHUB_TOKEN = ghp_seu_token_aqui
 *   3. Fazer redeploy
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

const GITHUB_MODELS_ENDPOINT =
  "https://models.github.ai/inference/chat/completions";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Apenas POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Token do env var (mais seguro) ou fallback para header enviado pelo cliente
  const token =
    process.env.GITHUB_TOKEN ||
    (req.headers["x-github-token"] as string | undefined);

  if (!token) {
    return res.status(503).json({
      error:
        "GitHub token não configurado. Adicione GITHUB_TOKEN nas variáveis de ambiente do Vercel.",
    });
  }

  try {
    const { model, messages, temperature, max_tokens, top_p } = req.body;

    const upstream = await fetch(GITHUB_MODELS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ model, messages, temperature, max_tokens, top_p }),
    });

    const data = await upstream.json();

    // Repassar status e corpo exatos da API upstream
    return res.status(upstream.status).json(data);
  } catch (err) {
    console.error("[api/llm] Erro no proxy:", err);
    return res.status(500).json({
      error: "Erro interno no proxy LLM.",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}
