// POST /api/ai-photo   (só a equipa)
// Recebe a fotografia que tiraste a um acessório (ex.: uma capa) e devolve:
//   - image : uma fotografia NOVA de estúdio, criada por IA, da mesma capa (Google "Nano Banana")
//   - fields: nome, categoria, compatibilidade, cor, preço sugerido e descrição (Google Gemini)
// Precisa da variável GEMINI_API_KEY no Vercel (chave do Google AI Studio, com faturação ativa
// para a parte da imagem). Os modelos podem trocar-se sem mexer no código:
//   GEMINI_IMAGE_MODEL (por omissão gemini-nano-banana-2.1)
//   GEMINI_TEXT_MODEL  (por omissão gemini-3.5-flash-lite)
import { json, getUser, isStaffEmail } from '../lib/db.mjs';

const API = 'https://generativelanguage.googleapis.com/v1beta/models/';
const IMAGE_MODEL = () => process.env.GEMINI_IMAGE_MODEL || 'gemini-nano-banana-2.1';
const TEXT_MODEL = () => process.env.GEMINI_TEXT_MODEL || 'gemini-3.5-flash-lite';

const IMAGE_PROMPT = `You are given a phone photo of a REAL product (usually a phone case or phone accessory) that a small electronics shop will sell online.
Create a brand-new professional e-commerce studio product photo of EXACTLY THE SAME product.
Absolutely keep the product identical to the reference photo: same exact colour and shade, same material and texture (matte, glossy, transparent, leather, silicone…), same shape, same camera cut-out size and position, same button covers, same edges and corners, same prints, patterns, logos and any text exactly as they appear. Do not invent, add, remove or "improve" any detail of the product.
If it is a case, show only the case (no phone inside, unless the reference clearly shows it on a phone), seen from the back at a slight 3/4 angle so its shape and camera area are clear.
Remove everything else: hands, fingers, table, packaging, reflections of the room, background.
Place it centred on a seamless soft light-grey studio background (#EFEFF1) with soft diffused studio lighting and a subtle natural contact shadow underneath. Sharp focus, high detail, realistic, square framing with comfortable margins.
No text, no labels, no watermark, no props, no extra objects.`;

// sem fotografia: cria uma foto ilustrativa só a partir do nome do produto
const TEXT_IMAGE_PROMPT = (what) => `Professional e-commerce studio product photo for an online phone accessories shop.
Product: ${what}
Show one realistic, generic version of this product (no brand names, no logos, no packaging text), the way it would look on a premium shop listing.
Centred on a seamless soft light-grey studio background (#EFEFF1), soft diffused studio lighting, subtle natural contact shadow, sharp focus, high detail, photorealistic, square framing with comfortable margins.
No text, no labels, no watermark, no hands, no props, no extra objects.`;

async function makeImageFromText(what, key) {
  const d = await gemini(IMAGE_MODEL(), {
    contents: [{ parts: [{ text: TEXT_IMAGE_PROMPT(what) }] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1', imageSize: '1K' } },
  }, key);
  const imgs = parts(d).map((p) => p.inlineData || p.inline_data).filter((x) => x && x.data);
  if (!imgs.length) throw new Error('A IA não devolveu nenhuma imagem.');
  const last = imgs[imgs.length - 1];
  return `data:${last.mimeType || last.mime_type || 'image/png'};base64,${last.data}`;
}

function textPrompt(hints, cats) {
  return `Analisa esta foto de um produto que uma loja de telemóveis em Portugal vai vender no site (normalmente uma capa, película, carregador, cabo, auricular ou outro acessório).
Responde APENAS com um objeto JSON (sem texto à volta) com estes campos, em português de Portugal:
{
  "name": "nome curto para a loja, ex.: 'Capa Silicone MagSafe iPhone 15 Pro — Azul'",
  "category": "uma destas categorias exatamente: ${cats.join(' | ')}",
  "compatible": "modelo(s) de telemóvel compatível(eis) se der para perceber (ex.: 'iPhone 15 Pro'), senão ''",
  "color": "cor principal",
  "material": "material (silicone, TPU transparente, pele, etc.) ou ''",
  "desc": "frase curta (máx. 80 caracteres) para a lista de produtos",
  "longDesc": "descrição do anúncio com 2 a 4 frases simples, honestas, sem inventar características que não se vejam",
  "price": número com o preço de venda sugerido em euros (ex.: 12.9), coerente com os preços desta loja,
  "confidence": "alta" | "media" | "baixa"
}
Se não conseguires identificar o modelo de telemóvel com certeza, NÃO inventes: deixa "compatible" vazio, não ponhas o modelo no nome e usa "confidence": "baixa".
Preços atuais de acessórios desta loja (para o preço ficar coerente):
${hints.length ? hints.map((h) => `- ${h.name} (${h.cat}): ${h.price} €`).join('\n') : '- (ainda sem acessórios registados — usa preços normais de uma loja de bairro em Portugal)'}`;
}

async function gemini(model, body, key) {
  const r = await fetch(API + model + ':generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (d.error && d.error.message) || ('Erro ' + r.status);
    throw Object.assign(new Error(msg), { status: r.status });
  }
  return d;
}
const parts = (d) => ((d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts) || []);

async function makeImage(img, mime, key) {
  const d = await gemini(IMAGE_MODEL(), {
    contents: [{ parts: [{ text: IMAGE_PROMPT }, { inline_data: { mime_type: mime, data: img } }] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1', imageSize: '1K' } },
  }, key);
  const imgs = parts(d).map((p) => p.inlineData || p.inline_data).filter((x) => x && x.data);
  if (!imgs.length) throw new Error('A IA não devolveu nenhuma imagem (tenta outra foto, com a capa bem visível).');
  const last = imgs[imgs.length - 1];
  return `data:${last.mimeType || last.mime_type || 'image/png'};base64,${last.data}`;
}

async function readFields(img, mime, hints, cats, key) {
  const req = (cfg) => gemini(TEXT_MODEL(), {
    contents: [{ parts: [{ inline_data: { mime_type: mime, data: img } }, { text: textPrompt(hints, cats) }] }],
    ...(cfg ? { generationConfig: cfg } : {}),
  }, key);
  let d;
  try { d = await req({ responseMimeType: 'application/json', temperature: 0.2 }); }
  catch (e) { if (e.status === 400) d = await req(null); else throw e; }   // se a API não aceitar a opção de JSON
  const txt = parts(d).map((p) => p.text || '').join('').replace(/```json|```/g, '').trim();
  const m = txt.match(/\{[\s\S]*\}/);
  const f = JSON.parse(m ? m[0] : txt);
  const s = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const price = Number(String(f.price ?? '').replace(',', '.'));
  return {
    name: s(f.name, 90), category: cats.includes(f.category) ? f.category : '', compatible: s(f.compatible, 60),
    color: s(f.color, 30), material: s(f.material, 40), desc: s(f.desc, 100), longDesc: s(f.longDesc, 700),
    price: isFinite(price) && price > 0 && price < 5000 ? Math.round(price * 100) / 100 : null,
    confidence: ['alta', 'media', 'baixa'].includes(f.confidence) ? f.confidence : 'media',
  };
}

function friendly(e) {
  const m = String(e && e.message || '');
  if (/billing|paid|quota|free tier|RESOURCE_EXHAUSTED/i.test(m) || (e && e.status === 429)) return 'A conta Google da IA precisa de faturação ativa (ou chegou ao limite). Vê em aistudio.google.com → Billing.';
  if (/API key|API_KEY|permission|PERMISSION_DENIED/i.test(m) || (e && e.status === 403)) return 'A chave GEMINI_API_KEY não é válida. Confirma-a no Vercel.';
  if (/not found|is not supported/i.test(m) || (e && e.status === 404)) return 'O modelo de IA mudou de nome. Ajusta GEMINI_IMAGE_MODEL / GEMINI_TEXT_MODEL no Vercel.';
  if (/safety|blocked/i.test(m)) return 'A IA recusou esta foto. Tenta outra, só com o produto.';
  return m.slice(0, 200) || 'Erro na IA.';
}

export default async (req) => {
  if (req.method === 'GET') return json(200, { on: !!process.env.GEMINI_API_KEY });
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido' });
  const user = await getUser(req).catch(() => null);
  if (!user || !(await isStaffEmail(user.email))) return json(403, { error: 'Só a equipa.' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return json(503, { error: 'Falta configurar a IA: põe a chave GEMINI_API_KEY no Vercel.', code: 'nokey' });

  const raw = await req.text().catch(() => '');
  if (raw.length > 4_000_000) return json(413, { error: 'Foto demasiado grande.' });
  let a = {}; try { a = JSON.parse(raw); } catch {}
  if (!a.image && typeof a.text === 'string' && a.text.trim()) {
    try { return json(200, { image: await makeImageFromText(a.text.trim().slice(0, 300), key) }); }
    catch (e) { console.error('ai-photo texto', e.message); return json(502, { error: friendly(e) }); }
  }
  const m = /^data:(image\/(jpeg|png|webp));base64,(.+)$/.exec(String(a.image || ''));
  if (!m) return json(400, { error: 'Falta a foto.' });
  const mime = m[1], img = m[3];
  const hints = (Array.isArray(a.hints) ? a.hints : []).slice(0, 60)
    .map((h) => ({ name: String(h.name || '').slice(0, 70), cat: String(h.cat || '').slice(0, 30), price: Number(h.price) || 0 }))
    .filter((h) => h.name && h.price);
  const cats = (Array.isArray(a.cats) ? a.cats : []).map((c) => String(c).slice(0, 40)).filter(Boolean).slice(0, 30);

  const [im, fi] = await Promise.allSettled([
    a.noImage ? Promise.resolve(null) : makeImage(img, mime, key),
    a.noFields ? Promise.resolve(null) : readFields(img, mime, hints, cats.length ? cats : ['Capas', 'Acessórios'], key),
  ]);
  if (im.status === 'rejected') console.error('ai-photo imagem', im.reason && im.reason.message);
  if (fi.status === 'rejected') console.error('ai-photo dados', fi.reason && fi.reason.message);
  if (im.status === 'rejected' && fi.status === 'rejected') return json(502, { error: friendly(im.reason) });
  return json(200, {
    image: im.status === 'fulfilled' ? im.value : null,
    imageError: im.status === 'rejected' ? friendly(im.reason) : null,
    fields: fi.status === 'fulfilled' ? fi.value : null,
    fieldsError: fi.status === 'rejected' ? friendly(fi.reason) : null,
  });
};
