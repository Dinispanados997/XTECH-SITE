// /api/auth/*  — contas (entrar, criar conta, Google, recuperar palavra-passe). Ver netlify/lib/auth.mjs
// O vercel.json reencaminha /api/auth/<caminho> para aqui com ?__ba=<caminho>.
import { getAuth } from '../lib/auth.mjs';
import { dbOn } from '../lib/sql.mjs';
import { json } from '../lib/db.mjs';

export default async (req) => {
  if (!dbOn() || !process.env.BETTER_AUTH_SECRET) return json(503, { error: 'As contas ainda não estão configuradas.' });
  const u = new URL(req.url);
  const sub = u.searchParams.get('__ba');
  if (sub != null) {
    u.searchParams.delete('__ba');
    u.pathname = '/api/auth/' + sub.replace(/^\/+/, '');
    const init = { method: req.method, headers: req.headers };
    if (!['GET', 'HEAD'].includes(req.method)) { init.body = await req.arrayBuffer(); }
    req = new Request(u.toString(), init);
  }
  return getAuth().handler(req);
};
