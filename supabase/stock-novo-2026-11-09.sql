-- Stock novo da Xtech Store (9 nov 2026): 4 iPhones
-- Corre no Supabase → SQL Editor → New query → Run.
-- ACRESCENTA estes equipamentos aos que já estão no site (não apaga nada).
-- Se algum destes ids (1, 3, 8, 9) já existir, é substituído pela versão abaixo.
with novos as (
  select $novos$[
    {"id": 1, "cat": "Telemóveis", "brand": "Apple", "model": "iPhone 17 Pro Max", "storage": "256GB", "color": "Laranja",         "battery": 98,  "cond": "Usado", "imei": "—", "price": 1100, "qty": 1, "photos": ["img/ip17.webp"]},
    {"id": 8, "cat": "Telemóveis", "brand": "Apple", "model": "iPhone 16 Pro",     "storage": "128GB", "color": "Titânio Deserto", "battery": 89,  "cond": "Usado", "imei": "—", "price": 700,  "qty": 1, "photos": ["img/ip16p.webp"]},
    {"id": 9, "cat": "Telemóveis", "brand": "Apple", "model": "iPhone 15 Pro",     "storage": "128GB", "color": "Titânio Natural", "battery": 100, "cond": "Usado", "imei": "—", "price": 580,  "qty": 1, "photos": ["img/ip15p.webp"]},
    {"id": 3, "cat": "Telemóveis", "brand": "Apple", "model": "iPhone 14",         "storage": "128GB", "color": "Azul",            "battery": 100, "cond": "Usado", "imei": "—", "price": 300,  "qty": 1, "photos": ["img/ip14.webp"]}
  ]$novos$::jsonb as v
),
atuais as (
  select coalesce(jsonb_agg(d), '[]'::jsonb) as v
  from public.kv, jsonb_array_elements(value) d
  where key = 'devices' and (d->>'id')::int not in (1, 3, 8, 9)
)
insert into public.kv (key, value)
select 'devices', novos.v || atuais.v from novos, atuais
on conflict (key) do update set value = excluded.value;

select d->>'model' as modelo, d->>'storage' as armazenamento, d->>'battery' as bateria, d->>'price' as preco, d->>'qty' as qtd
from public.kv, jsonb_array_elements(value) d where key = 'devices';
