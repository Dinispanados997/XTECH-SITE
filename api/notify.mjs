// Vercel: reaproveita a função do Netlify (netlify/functions/notify.mjs) sem a alterar.
import handler from '../netlify/functions/notify.mjs';
const h = (req) => handler(req, {});
export { h as GET, h as POST, h as PUT, h as DELETE, h as OPTIONS };
