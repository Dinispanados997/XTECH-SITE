// POST /.netlify/functions/ai
// Ponte para a IA (assistente do site, orçamentos, descrições de produtos).
// A chave da Anthropic fica escondida no Netlify (variável ANTHROPIC_API_KEY).
// Se não quiseres usar IA, simplesmente não configures a chave: o site continua a funcionar.
import { json } from '../lib/db.mjs';

const MAX_TOKENS = 1200;
const hits = new Map(); // limite simples por IP para evitar abusos

export default async (req) => {
  const key = process.env.ANTHROPIC_API_KEY;
  // o site pergunta isto ao abrir: sem chave, usa o assistente sem IA
  if (req.method === 'GET') return json(200, { ai: !!key });
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido' });
  if (!key) return json(503, { error: 'IA não configurada' });

  const ip = req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || 'x';
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60_000);
  if (arr.length >= 20) return json(429, { error: 'Demasiados pedidos. Tenta daqui a um minuto.' });
  arr.push(now); hits.set(ip, arr);

  // só aceita pedidos vindos do próprio site
  const origin = req.headers.get('origin') || '';
  const site = (process.env.SITE_URL || process.env.URL || '').replace(/\/$/, '');
  const self = new URL(req.url).origin;
  if (origin && origin !== self && (!site || origin !== site)) return json(403, { error: 'Origem não permitida' });

  const raw = await req.text().catch(() => '');
  if (raw.length > 4_000_000) return json(413, { error: 'Pedido demasiado grande' }); // fotos do admin podem ser grandes
  let body = null; try { body = JSON.parse(raw); } catch (e) {}
  if (!body || !Array.isArray(body.messages)) return json(400, { error: 'Pedido inválido' });
  const payload = {
    // o modelo é escolhido aqui no servidor (o browser não pode pedir um modelo mais caro)
    model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
    max_tokens: Math.min(Number(body.max_tokens) || 800, MAX_TOKENS),
    messages: body.messages.slice(-30),
    ...(body.system ? { system: body.system } : {}),
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  return new Response(text, { status: res.status, headers: { 'Content-Type': 'application/json' } });
};
