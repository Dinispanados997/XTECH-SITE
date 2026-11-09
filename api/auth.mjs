// Vercel: reaproveita a função do Netlify (netlify/functions/auth.mjs) sem a alterar.
import handler from '../netlify/functions/auth.mjs';
const h = (req) => handler(req, {});
export { h as GET, h as POST, h as PUT, h as DELETE, h as OPTIONS };
