// Vercel: foto de produto criada por IA (ver netlify/functions/ai-photo.mjs).
import handler from '../netlify/functions/ai-photo.mjs';
export const maxDuration = 90; // a imagem pode demorar uns 10–30 s
const h = (req) => handler(req, {});
export { h as GET, h as POST };
