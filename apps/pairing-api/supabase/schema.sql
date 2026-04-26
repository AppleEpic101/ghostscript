create extension if not exists pgcrypto;

create table if not exists public.pairing_sessions (
  id uuid primary key default gen_random_uuid(),
  invite_code char(4) not null unique,
  invite_format text not null default '4-digit' check (invite_format = '4-digit'),
  cover_topic text not null,
  status text not null check (status in ('invite-pending', 'paired', 'invalidated')),
  inviter_id uuid,
  joiner_id uuid,
  invite_consumed boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  joined_at timestamptz,
  invalidated_at timestamptz,
  constraint pairing_sessions_invite_code_digits check (invite_code ~ '^[0-9]{4}$'),
  constraint pairing_sessions_joiner_requires_joined_at
    check ((joiner_id is null and joined_at is null) or (joiner_id is not null and joined_at is not null)),
  constraint pairing_sessions_consumed_matches_joiner
    check ((invite_consumed = false and joiner_id is null) or (invite_consumed = true and joiner_id is not null))
);

create table if not exists public.pairing_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.pairing_sessions(id) on delete cascade,
  role text not null check (role in ('inviter', 'joiner')),
  display_name text not null check (length(btrim(display_name)) > 0),
  identity_public_key text,
  created_at timestamptz not null default now(),
  unique (session_id, role)
);

alter table public.pairing_participants
  add column if not exists identity_public_key text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pairing_sessions_inviter_fk'
  ) then
    alter table public.pairing_sessions
      add constraint pairing_sessions_inviter_fk
      foreign key (inviter_id) references public.pairing_participants(id) deferrable initially deferred;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'pairing_sessions_joiner_fk'
  ) then
    alter table public.pairing_sessions
      add constraint pairing_sessions_joiner_fk
      foreign key (joiner_id) references public.pairing_participants(id) deferrable initially deferred;
  end if;
end $$;

create index if not exists pairing_sessions_status_idx on public.pairing_sessions (status);
create index if not exists pairing_sessions_expires_at_idx on public.pairing_sessions (expires_at);
create index if not exists pairing_participants_session_id_idx on public.pairing_participants (session_id);

alter table public.pairing_sessions enable row level security;
alter table public.pairing_participants enable row level security;

create or replace function public.create_pairing_invite(
  inviter_name_input text,
  cover_topic_input text,
  identity_public_key_input text,
  expires_at_input timestamptz
)
returns table (invite_code char(4))
language plpgsql
set search_path = public
as $$
declare
  next_invite_code char(4);
  next_session_id uuid;
  next_inviter_id uuid;
begin
  if length(btrim(inviter_name_input)) = 0 then
    raise exception 'inviterName is required.';
  end if;

  if length(btrim(cover_topic_input)) = 0 then
    raise exception 'coverTopic is required.';
  end if;

  if length(coalesce(btrim(identity_public_key_input), '')) = 0 then
    raise exception 'identityPublicKey is required.';
  end if;

  for attempt in 1..20 loop
    next_invite_code := lpad(floor(random() * 10000)::text, 4, '0');

    begin
      insert into public.pairing_sessions (
        invite_code,
        cover_topic,
        status,
        expires_at
      )
      values (
        next_invite_code,
        btrim(cover_topic_input),
        'invite-pending',
        expires_at_input
      )
      returning id into next_session_id;

      insert into public.pairing_participants (
        session_id,
        role,
        display_name,
        identity_public_key
      )
      values (
        next_session_id,
        'inviter',
        btrim(inviter_name_input),
        btrim(identity_public_key_input)
      )
      returning id into next_inviter_id;

      update public.pairing_sessions
      set inviter_id = next_inviter_id
      where id = next_session_id;

      invite_code := next_invite_code;
      return next;
      return;
    exception
      when unique_violation then
        next_invite_code := null;
    end;
  end loop;

  raise exception 'Unable to mint a unique invite code.';
end;
$$;

create or replace function public.claim_pairing_invite(
  invite_code_input text,
  joiner_name_input text,
  identity_public_key_input text
)
returns void
language plpgsql
set search_path = public
as $$
declare
  session_row public.pairing_sessions%rowtype;
  next_joiner_id uuid;
  claimed_at timestamptz := now();
begin
  if invite_code_input !~ '^[0-9]{4}$' then
    raise exception 'Invite codes must be 4 digits.';
  end if;

  if length(btrim(joiner_name_input)) = 0 then
    raise exception 'joinerName is required.';
  end if;

  if length(coalesce(btrim(identity_public_key_input), '')) = 0 then
    raise exception 'identityPublicKey is required.';
  end if;

  select *
  into session_row
  from public.pairing_sessions
  where invite_code = invite_code_input
  for update;

  if not found then
    raise exception 'Invite code not found.';
  end if;

  if session_row.status = 'invalidated' or session_row.invalidated_at is not null then
    raise exception 'This invite is no longer valid.';
  end if;

  if session_row.expires_at <= now() then
    update public.pairing_sessions
    set status = 'invalidated',
        invalidated_at = coalesce(session_row.invalidated_at, claimed_at)
    where id = session_row.id;

    raise exception 'This invite has expired.';
  end if;

  if session_row.joiner_id is not null or session_row.invite_consumed then
    raise exception 'This invite has already been used.';
  end if;

  insert into public.pairing_participants (
    session_id,
    role,
    display_name,
    identity_public_key
  )
  values (
    session_row.id,
    'joiner',
    btrim(joiner_name_input),
    btrim(identity_public_key_input)
  )
  returning id into next_joiner_id;

  update public.pairing_sessions
  set joiner_id = next_joiner_id,
      joined_at = claimed_at,
      invite_consumed = true,
      status = 'paired'
  where id = session_row.id;
end;
$$;
