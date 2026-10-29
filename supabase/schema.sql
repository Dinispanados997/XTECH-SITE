-- =====================================================================
--  XTECH STORE — base de dados da loja online (Supabase / Postgres)
--  Corre este ficheiro UMA vez em: Supabase → SQL Editor → New query → Run
--  Pode ser corrido de novo sem estragar nada (é idempotente).
-- =====================================================================

-- ---------- Equipa (quem entra no painel de admin) ----------
create table if not exists public.staff (
  email      text primary key,
  name       text,
  role       text not null default 'staff',
  created_at timestamptz not null default now()
);

-- true se o utilizador com sessão iniciada pertence à equipa
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.staff
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ---------- Dados da loja (produtos, reparações, finanças, …) ----------
-- Cada "chave" guarda uma lista em JSON, tal como o site já fazia no browser.
create table if not exists public.kv (
  key        text primary key,
  value      jsonb,
  updated_at timestamptz not null default now()
);

-- ---------- Encomendas feitas no site ----------
create table if not exists public.orders (
  id                bigint generated always as identity primary key,
  number            text generated always as ('XT-' || lpad(id::text, 5, '0')) stored,
  user_id           uuid references auth.users(id) on delete set null,
  email             text not null,
  name              text,
  phone             text,
  nif               text,
  items             jsonb not null default '[]',
  subtotal          numeric(10,2) not null default 0,
  shipping          numeric(10,2) not null default 0,
  total             numeric(10,2) not null default 0,
  delivery          jsonb not null default '{}',   -- {method:'pickup'|'ship', address, zip, city}
  payment_method    text not null default 'online', -- 'online' | 'loja'
  status            text not null default 'por_pagar',
  stripe_session_id text,
  paid_with         text,
  tracking          jsonb not null default '{}',   -- {company, code}
  notes             text,
  history           jsonb not null default '[]',   -- [{status, at}]
  stock_done        boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists orders_user_idx on public.orders(user_id);
create index if not exists orders_status_idx on public.orders(status);

-- ---------- Pedidos de devolução ----------
create table if not exists public.returns (
  id          bigint generated always as identity primary key,
  order_id    bigint not null references public.orders(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  email       text,
  items       text,
  reason      text,
  details     text,
  status      text not null default 'pedido',
  admin_note  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- Caixa de entrada (pedidos de orçamento/reparação vindos do site) ----------
create table if not exists public.inbox (
  id          bigint generated always as identity primary key,
  kind        text not null,                -- 'quote'
  user_id     uuid,
  email       text,
  payload     jsonb not null default '{}',
  status      text not null default 'Pendente',
  imported    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- updated_at automático
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists orders_touch on public.orders;
create trigger orders_touch before update on public.orders for each row execute function public.touch_updated_at();
drop trigger if exists returns_touch on public.returns;
create trigger returns_touch before update on public.returns for each row execute function public.touch_updated_at();
drop trigger if exists kv_touch on public.kv;
create trigger kv_touch before update on public.kv for each row execute function public.touch_updated_at();

-- ---------- O cliente pode cancelar uma encomenda ainda não paga/preparada ----------
create or replace function public.cancel_my_order(p_id bigint) returns public.orders
language plpgsql security definer set search_path = public as $$
declare r public.orders;
begin
  update public.orders
     set status = 'cancelada',
         history = history || jsonb_build_array(jsonb_build_object('status','cancelada','at',now(),'by','cliente'))
   where id = p_id
     and user_id = auth.uid()
     and status in ('por_pagar','pagar_na_loja','pagamento_falhou')
  returning * into r;
  if r.id is null then raise exception 'Esta encomenda já não pode ser cancelada.'; end if;
  return r;
end $$;

-- =====================================================================
--  SEGURANÇA (Row Level Security): quem pode ler/escrever o quê
-- =====================================================================
alter table public.staff   enable row level security;
alter table public.kv      enable row level security;
alter table public.orders  enable row level security;
alter table public.returns enable row level security;
alter table public.inbox   enable row level security;

drop policy if exists staff_read  on public.staff;
drop policy if exists staff_write on public.staff;
create policy staff_read  on public.staff for select using (public.is_staff() or lower(email) = lower(coalesce(auth.jwt() ->> 'email','')));
create policy staff_write on public.staff for all    using (public.is_staff()) with check (public.is_staff());

-- produtos e transportadoras são públicos; o resto só a equipa vê
drop policy if exists kv_public_read on public.kv;
drop policy if exists kv_staff_all   on public.kv;
create policy kv_public_read on public.kv for select using (key in ('devices','accessories','carriers','shopSettings','agendaSettings') or public.is_staff());
create policy kv_staff_all   on public.kv for all    using (public.is_staff()) with check (public.is_staff());

-- encomendas: o cliente vê as suas; a equipa vê e altera todas.
-- (as encomendas são criadas pelo servidor — função create-order — que valida os preços)
drop policy if exists orders_read   on public.orders;
drop policy if exists orders_update on public.orders;
create policy orders_read   on public.orders for select using (user_id = auth.uid() or public.is_staff());
create policy orders_update on public.orders for update using (public.is_staff()) with check (public.is_staff());

-- devoluções: o cliente pede para as suas encomendas; a equipa gere
drop policy if exists returns_read   on public.returns;
drop policy if exists returns_insert on public.returns;
drop policy if exists returns_update on public.returns;
create policy returns_read   on public.returns for select using (user_id = auth.uid() or public.is_staff());
create policy returns_insert on public.returns for insert with check (
  user_id = auth.uid() and exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())
);
create policy returns_update on public.returns for update using (public.is_staff()) with check (public.is_staff());

-- caixa de entrada: qualquer visitante pode enviar; vê os seus; a equipa gere
drop policy if exists inbox_insert on public.inbox;
drop policy if exists inbox_read   on public.inbox;
drop policy if exists inbox_staff  on public.inbox;
create policy inbox_insert on public.inbox for insert with check (user_id is null or user_id = auth.uid());
create policy inbox_read   on public.inbox for select using (
  public.is_staff() or user_id = auth.uid() or (email is not null and lower(email) = lower(coalesce(auth.jwt() ->> 'email','')))
);
create policy inbox_staff  on public.inbox for update using (public.is_staff()) with check (public.is_staff());

grant execute on function public.cancel_my_order(bigint) to authenticated;
grant execute on function public.is_staff() to anon, authenticated;

-- =====================================================================
--  MARCAÇÕES DE REPARAÇÃO (agendamento online)
--  Os clientes marcam pela função book_service, que valida tudo no servidor
--  (horário da loja, dias fechados, vagas por horário, antecedência mínima).
--  Ninguém de fora consegue ler marcações de outras pessoas.
-- =====================================================================
create table if not exists public.bookings (
  id            bigint generated always as identity primary key,
  number        text generated always as ('AG-' || lpad(id::text, 5, '0')) stored,
  user_id       uuid references auth.users(id) on delete set null,
  service       text not null,
  service_label text,
  device        text,
  issue         text,
  day           date not null,
  slot          text not null,                    -- 'HH:MM'
  name          text not null,
  phone         text not null,
  email         text,
  status        text not null default 'pendente', -- pendente | confirmada | concluida | faltou | cancelada
  source        text not null default 'site',     -- site | loja
  admin_note    text,
  repair_id     bigint,
  history       jsonb not null default '[]',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists bookings_day_idx   on public.bookings(day, slot);
create index if not exists bookings_user_idx  on public.bookings(user_id);
create index if not exists bookings_phone_idx on public.bookings(phone);
drop trigger if exists bookings_touch on public.bookings;
create trigger bookings_touch before update on public.bookings for each row execute function public.touch_updated_at();

-- horários ocupados (só dia, hora e quantidade — sem nomes nem contactos)
create or replace function public.booking_busy(p_from date, p_to date)
returns table(day date, slot text, n int)
language sql stable security definer set search_path = public as $$
  select b.day, b.slot, count(*)::int
    from public.bookings b
   where b.day between p_from and least(p_to, p_from + 62)
     and b.status in ('pendente','confirmada')
   group by b.day, b.slot;
$$;

-- criar uma marcação (clientes com ou sem conta)
create or replace function public.book_service(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s        jsonb := coalesce((select value from public.kv where key = 'agendaSettings'), '{}'::jsonb);
  v_now    timestamp := (now() at time zone 'Europe/Lisbon');
  v_today  date := (now() at time zone 'Europe/Lisbon')::date;
  v_step   int := coalesce(nullif(s->>'slotMin','')::int, 30);
  v_cap    int := greatest(1, coalesce(nullif(s->>'perSlot','')::int, 1));
  v_notice int := coalesce(nullif(s->>'noticeMin','')::int, 60);
  v_maxd   int := coalesce(nullif(s->>'maxDays','')::int, 30);
  v_hours  jsonb := '{"1":["09:30","19:00"],"2":["09:30","19:00"],"3":["09:30","19:00"],"4":["09:30","19:00"],"5":["09:30","19:00"],"6":["10:00","13:00"],"7":null}'::jsonb || coalesce(s->'hours', '{}'::jsonb);
  v_h jsonb; v_day date; v_slot text; v_min int; v_open int; v_close int; v_p0 int; v_p1 int;
  v_phone text; v_email text; v_n int; v_label text; r public.bookings;
  services constant text[] := array['diagnostico','ecra','bateria','camara','conector','software','placa','outro'];
  labels   constant text[] := array['Diagnóstico gratuito','Ecrã partido','Bateria','Câmara e sensores','Conector de carga','Software e desbloqueio','Placa lógica','Outro problema'];
begin
  if coalesce((s->>'enabled')::boolean, true) = false then
    raise exception 'As marcações online estão desativadas de momento. Liga-nos: 923 512 686.';
  end if;
  if not (coalesce(p->>'service','') = any(services)) then raise exception 'Escolhe o serviço.'; end if;
  v_label := labels[array_position(services, p->>'service')];
  begin v_day := (p->>'day')::date; exception when others then raise exception 'Escolhe o dia.'; end;
  if v_day is null then raise exception 'Escolhe o dia.'; end if;
  v_slot := coalesce(p->>'slot','');
  if v_slot !~ '^\d{2}:\d{2}$' then raise exception 'Escolhe a hora.'; end if;
  v_min := split_part(v_slot, ':', 1)::int * 60 + split_part(v_slot, ':', 2)::int;
  if length(trim(coalesce(p->>'name',''))) < 2 or length(p->>'name') > 80 then raise exception 'Indica o teu nome.'; end if;
  v_phone := regexp_replace(coalesce(p->>'phone',''), '\D', '', 'g');
  if v_phone ~ '^(00)?351\d{9}$' then v_phone := right(v_phone, 9); end if;
  if v_phone !~ '^[239]\d{8}$' then raise exception 'Indica um número de telemóvel válido (9 dígitos).'; end if;
  v_email := lower(trim(coalesce(p->>'email','')));
  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Indica o teu email, para receberes a confirmação.'; end if;
  if length(coalesce(p->>'device','')) > 80 or length(coalesce(p->>'issue','')) > 600 then raise exception 'Texto demasiado longo.'; end if;

  if v_day < v_today or v_day > v_today + v_maxd then raise exception 'Escolhe uma data dentro dos próximos % dias.', v_maxd; end if;
  if coalesce(s->'closed', '[]'::jsonb) ? v_day::text then raise exception 'A loja está fechada nesse dia.'; end if;
  v_h := v_hours -> (extract(isodow from v_day)::int)::text;
  if v_h is null or jsonb_typeof(v_h) <> 'array' or jsonb_array_length(v_h) < 2 then raise exception 'A loja está fechada nesse dia.'; end if;
  v_open  := split_part(v_h->>0, ':', 1)::int * 60 + split_part(v_h->>0, ':', 2)::int;
  v_close := split_part(v_h->>1, ':', 1)::int * 60 + split_part(v_h->>1, ':', 2)::int;
  if coalesce(v_h->>2,'') <> '' and coalesce(v_h->>3,'') <> '' then
    v_p0 := split_part(v_h->>2, ':', 1)::int * 60 + split_part(v_h->>2, ':', 2)::int;
    v_p1 := split_part(v_h->>3, ':', 1)::int * 60 + split_part(v_h->>3, ':', 2)::int;
  end if;
  if v_min < v_open or v_min + v_step > v_close or (v_min - v_open) % v_step <> 0
     or (v_p0 is not null and v_min + v_step > v_p0 and v_min < v_p1) then
    raise exception 'Esse horário não está disponível.';
  end if;
  if v_day = v_today and v_min < extract(hour from v_now)::int * 60 + extract(minute from v_now)::int + v_notice then
    raise exception 'Esse horário já passou. Escolhe outro.';
  end if;

  -- evita que duas pessoas fiquem com a mesma vaga ao mesmo tempo
  perform pg_advisory_xact_lock(hashtext('agenda ' || v_day::text || ' ' || v_slot));
  select count(*) into v_n from public.bookings b where b.day = v_day and b.slot = v_slot and b.status in ('pendente','confirmada');
  if v_n >= v_cap then raise exception 'Esse horário acabou de ficar ocupado. Escolhe outro.'; end if;
  select count(*) into v_n from public.bookings b where b.phone = v_phone and b.day >= v_today and b.status in ('pendente','confirmada');
  if v_n >= 3 then raise exception 'Já tens 3 marcações ativas com este número. Liga-nos para marcar mais.'; end if;

  insert into public.bookings (user_id, service, service_label, device, issue, day, slot, name, phone, email, history)
  values (auth.uid(), p->>'service', v_label, nullif(trim(coalesce(p->>'device','')),''), nullif(trim(coalesce(p->>'issue','')),''),
          v_day, v_slot, trim(p->>'name'), v_phone, nullif(v_email,''),
          jsonb_build_array(jsonb_build_object('status','pendente','at',now(),'by','cliente')))
  returning * into r;
  return jsonb_build_object('id', r.id, 'number', r.number, 'day', r.day, 'slot', r.slot);
end $$;

-- o cliente com conta pode desmarcar
create or replace function public.cancel_my_booking(p_id bigint) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare r public.bookings;
begin
  update public.bookings
     set status = 'cancelada',
         history = history || jsonb_build_array(jsonb_build_object('status','cancelada','at',now(),'by','cliente'))
   where id = p_id and user_id = auth.uid()
     and status in ('pendente','confirmada')
     and day >= (now() at time zone 'Europe/Lisbon')::date
  returning * into r;
  if r.id is null then raise exception 'Esta marcação já não pode ser cancelada.'; end if;
  return r;
end $$;

alter table public.bookings enable row level security;
drop policy if exists bookings_read  on public.bookings;
drop policy if exists bookings_staff on public.bookings;
create policy bookings_read  on public.bookings for select using (user_id = auth.uid() or public.is_staff());
create policy bookings_staff on public.bookings for all    using (public.is_staff()) with check (public.is_staff());

grant execute on function public.booking_busy(date, date) to anon, authenticated;
grant execute on function public.book_service(jsonb)      to anon, authenticated;
grant execute on function public.cancel_my_booking(bigint) to authenticated;

-- =====================================================================
--  EMAILS AUTOMÁTICOS
--  Cada encomenda / devolução / marcação guarda que emails já recebeu,
--  para nunca enviar o mesmo email duas vezes.
-- =====================================================================
-- ao criar a coluna, o que já existia fica marcado como "antigo" (não recebe emails atrasados)
do $$ declare t text; begin
  foreach t in array array['orders','returns','bookings'] loop
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'emails') then
      execute format('alter table public.%I add column emails jsonb not null default ''[]''', t);
      execute format('update public.%I set emails = ''[{"k":"antigo"}]''::jsonb', t);
    end if;
  end loop;
end $$;

-- reserva um email (devolve true só a quem chegar primeiro)
create or replace function public.claim_email(p_table text, p_id bigint, p_key text) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_table not in ('orders','returns','bookings') then raise exception 'tabela inválida'; end if;
  execute format('update public.%I set emails = emails || jsonb_build_array(jsonb_build_object(''k'', $1, ''at'', now()))
                   where id = $2 and not (emails @> jsonb_build_array(jsonb_build_object(''k'', $1)))', p_table)
    using p_key, p_id;
  get diagnostics n = row_count;
  return n > 0;
end $$;
-- se o envio falhar, liberta a reserva para tentar mais tarde
create or replace function public.unclaim_email(p_table text, p_id bigint, p_key text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_table not in ('orders','returns','bookings') then raise exception 'tabela inválida'; end if;
  execute format('update public.%I set emails = coalesce((select jsonb_agg(e) from jsonb_array_elements(emails) e where e->>''k'' <> $1), ''[]''::jsonb) where id = $2', p_table)
    using p_key, p_id;
end $$;
-- só o servidor (chave service_role) pode usar estas duas funções
revoke all on function public.claim_email(text, bigint, text)   from public, anon, authenticated;
revoke all on function public.unclaim_email(text, bigint, text) from public, anon, authenticated;
grant execute on function public.claim_email(text, bigint, text)   to service_role;
grant execute on function public.unclaim_email(text, bigint, text) to service_role;

-- =====================================================================
--  TEMPO REAL: as encomendas novas aparecem logo no painel
-- =====================================================================
do $$ begin
  begin alter publication supabase_realtime add table public.orders;  exception when others then null; end;
  begin alter publication supabase_realtime add table public.returns; exception when others then null; end;
  begin alter publication supabase_realtime add table public.inbox;   exception when others then null; end;
  begin alter publication supabase_realtime add table public.kv;      exception when others then null; end;
  begin alter publication supabase_realtime add table public.bookings; exception when others then null; end;
end $$;

-- =====================================================================
--  FOTOGRAFIAS DOS PRODUTOS (Storage, bucket público "fotos")
-- =====================================================================
insert into storage.buckets (id, name, public) values ('fotos', 'fotos', true)
on conflict (id) do update set public = true;

drop policy if exists fotos_read   on storage.objects;
drop policy if exists fotos_write  on storage.objects;
drop policy if exists fotos_update on storage.objects;
create policy fotos_read   on storage.objects for select using (bucket_id = 'fotos');
create policy fotos_write  on storage.objects for insert with check (bucket_id = 'fotos' and public.is_staff());
create policy fotos_update on storage.objects for update using (bucket_id = 'fotos' and public.is_staff());

-- =====================================================================
--  PRIMEIRO ADMIN — muda o email abaixo para o teu e corre só esta linha
--  DEPOIS de teres criado conta no site com esse email (e confirmado o email).
-- =====================================================================
-- insert into public.staff (email, name, role) values ('xtechstorept@gmail.com', 'Dinis', 'Admin') on conflict do nothing;
