-- =====================================================================
--  XTECH STORE — base de dados da loja online (Neon / Postgres)
--  Corre-se sozinho com:  node scripts/neon-setup.mjs
--  Pode ser corrido de novo sem estragar nada (é idempotente).
--
--  Diferença para o Supabase: o browser nunca fala diretamente com a base
--  de dados. Tudo passa pela função /api/data, que verifica quem é quem
--  (cliente, equipa ou visitante). As contas estão nas tabelas "user",
--  "account", "session" e "verification" (Better Auth).
-- =====================================================================

-- ---------- Equipa (quem entra no painel de admin) ----------
create table if not exists public.staff (
  email      text primary key,
  name       text,
  role       text not null default 'staff',
  created_at timestamptz not null default now()
);

-- ---------- Dados da loja (produtos, reparações, finanças, …) ----------
create table if not exists public.kv (
  key        text primary key,
  value      jsonb,
  updated_at timestamptz not null default now()
);

-- ---------- Encomendas feitas no site ----------
create table if not exists public.orders (
  id                bigint generated always as identity primary key,
  number            text generated always as ('XT-' || lpad(id::text, 5, '0')) stored,
  user_id           text,
  email             text not null,
  name              text,
  phone             text,
  nif               text,
  items             jsonb not null default '[]',
  subtotal          numeric(10,2) not null default 0,
  shipping          numeric(10,2) not null default 0,
  total             numeric(10,2) not null default 0,
  delivery          jsonb not null default '{}',
  payment_method    text not null default 'online',
  status            text not null default 'por_pagar',
  stripe_session_id text,
  paid_with         text,
  tracking          jsonb not null default '{}',
  notes             text,
  history           jsonb not null default '[]',
  stock_done        boolean not null default false,
  emails            jsonb not null default '[]',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists orders_user_idx on public.orders(user_id);
create index if not exists orders_status_idx on public.orders(status);
create index if not exists orders_updated_idx on public.orders(updated_at);

-- ---------- Pedidos de devolução ----------
create table if not exists public.returns (
  id          bigint generated always as identity primary key,
  order_id    bigint not null references public.orders(id) on delete cascade,
  user_id     text,
  email       text,
  items       text,
  reason      text,
  details     text,
  status      text not null default 'pedido',
  admin_note  text,
  emails      jsonb not null default '[]',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- Caixa de entrada (pedidos de orçamento vindos do site) ----------
create table if not exists public.inbox (
  id          bigint generated always as identity primary key,
  kind        text not null,
  user_id     text,
  email       text,
  payload     jsonb not null default '{}',
  status      text not null default 'Pendente',
  imported    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- Marcações de reparação ----------
create table if not exists public.bookings (
  id            bigint generated always as identity primary key,
  number        text generated always as ('AG-' || lpad(id::text, 5, '0')) stored,
  user_id       text,
  service       text not null,
  service_label text,
  device        text,
  issue         text,
  day           date not null,
  slot          text not null,
  name          text not null,
  phone         text not null,
  email         text,
  status        text not null default 'pendente',
  source        text not null default 'site',
  admin_note    text,
  repair_id     bigint,
  history       jsonb not null default '[]',
  emails        jsonb not null default '[]',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists bookings_day_idx   on public.bookings(day, slot);
create index if not exists bookings_user_idx  on public.bookings(user_id);
create index if not exists bookings_phone_idx on public.bookings(phone);

-- ---------- updated_at automático ----------
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
do $$ declare t text; begin
  foreach t in array array['orders','returns','kv','bookings','inbox'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated_at()', t || '_touch', t);
  end loop;
end $$;

-- ---------- O cliente pode cancelar uma encomenda ainda não paga ----------
drop function if exists public.cancel_my_order(bigint);
create or replace function public.cancel_my_order(p_id bigint, p_user text) returns public.orders
language plpgsql as $$
declare r public.orders;
begin
  update public.orders
     set status = 'cancelada',
         history = history || jsonb_build_array(jsonb_build_object('status','cancelada','at',now(),'by','cliente'))
   where id = p_id and user_id = p_user
     and status in ('por_pagar','pagar_na_loja','pagamento_falhou')
  returning * into r;
  if r.id is null then raise exception 'Esta encomenda já não pode ser cancelada.'; end if;
  return r;
end $$;

-- ---------- horários ocupados (só dia, hora e quantidade) ----------
create or replace function public.booking_busy(p_from date, p_to date)
returns table(day date, slot text, n int)
language sql stable as $$
  select b.day, b.slot, count(*)::int
    from public.bookings b
   where b.day between p_from and least(p_to, p_from + 62)
     and b.status in ('pendente','confirmada')
   group by b.day, b.slot;
$$;

-- ---------- criar uma marcação (clientes com ou sem conta) ----------
drop function if exists public.book_service(jsonb);
create or replace function public.book_service(p jsonb, p_user text) returns jsonb
language plpgsql as $$
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

  perform pg_advisory_xact_lock(hashtext('agenda ' || v_day::text || ' ' || v_slot));
  select count(*) into v_n from public.bookings b where b.day = v_day and b.slot = v_slot and b.status in ('pendente','confirmada');
  if v_n >= v_cap then raise exception 'Esse horário acabou de ficar ocupado. Escolhe outro.'; end if;
  select count(*) into v_n from public.bookings b where b.phone = v_phone and b.day >= v_today and b.status in ('pendente','confirmada');
  if v_n >= 3 then raise exception 'Já tens 3 marcações ativas com este número. Liga-nos para marcar mais.'; end if;

  insert into public.bookings (user_id, service, service_label, device, issue, day, slot, name, phone, email, history)
  values (p_user, p->>'service', v_label, nullif(trim(coalesce(p->>'device','')),''), nullif(trim(coalesce(p->>'issue','')),''),
          v_day, v_slot, trim(p->>'name'), v_phone, nullif(v_email,''),
          jsonb_build_array(jsonb_build_object('status','pendente','at',now(),'by','cliente')))
  returning * into r;
  return jsonb_build_object('id', r.id, 'number', r.number, 'day', r.day, 'slot', r.slot);
end $$;

-- ---------- o cliente com conta pode desmarcar ----------
drop function if exists public.cancel_my_booking(bigint);
create or replace function public.cancel_my_booking(p_id bigint, p_user text) returns public.bookings
language plpgsql as $$
declare r public.bookings;
begin
  update public.bookings
     set status = 'cancelada',
         history = history || jsonb_build_array(jsonb_build_object('status','cancelada','at',now(),'by','cliente'))
   where id = p_id and user_id = p_user
     and status in ('pendente','confirmada')
     and day >= (now() at time zone 'Europe/Lisbon')::date
  returning * into r;
  if r.id is null then raise exception 'Esta marcação já não pode ser cancelada.'; end if;
  return r;
end $$;

-- ---------- emails automáticos: nunca enviar o mesmo email duas vezes ----------
create or replace function public.claim_email(p_table text, p_id bigint, p_key text) returns boolean
language plpgsql as $$
declare n int;
begin
  if p_table not in ('orders','returns','bookings') then raise exception 'tabela inválida'; end if;
  execute format('update public.%I set emails = emails || jsonb_build_array(jsonb_build_object(''k'', $1, ''at'', now()))
                   where id = $2 and not (emails @> jsonb_build_array(jsonb_build_object(''k'', $1)))', p_table)
    using p_key, p_id;
  get diagnostics n = row_count;
  return n > 0;
end $$;
create or replace function public.unclaim_email(p_table text, p_id bigint, p_key text) returns void
language plpgsql as $$
begin
  if p_table not in ('orders','returns','bookings') then raise exception 'tabela inválida'; end if;
  execute format('update public.%I set emails = coalesce((select jsonb_agg(e) from jsonb_array_elements(emails) e where e->>''k'' <> $1), ''[]''::jsonb) where id = $2', p_table)
    using p_key, p_id;
end $$;
