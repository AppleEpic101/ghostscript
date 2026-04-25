create extension if not exists pgcrypto;

create table if not exists public.pairing_sessions (
  id uuid primary key default gen_random_uuid(),
  invite_code text not null unique,
  status text not null check (status in ('pending', 'paired-unverified', 'verified', 'invalidated')),
  inviter_id uuid,
  joiner_id uuid,
  expires_at timestamptz not null,
  joined_at timestamptz,
  verified_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.pairing_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.pairing_sessions(id) on delete cascade,
  role text not null check (role in ('inviter', 'joiner')),
  display_name text not null,
  identity_provider text not null,
  identity_subject text not null,
  identity_email text,
  identity_email_verified boolean not null default false,
  public_key_key_id text not null,
  public_key_algorithm text not null,
  public_key_value text not null,
  public_key_fingerprint text not null,
  public_key_created_at timestamptz not null,
  confirmed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique (session_id, role)
);

create index if not exists pairing_sessions_invite_code_idx
  on public.pairing_sessions (invite_code);

create index if not exists pairing_sessions_status_idx
  on public.pairing_sessions (status);

create index if not exists pairing_participants_session_id_idx
  on public.pairing_participants (session_id);

create index if not exists pairing_participants_identity_subject_idx
  on public.pairing_participants (identity_subject);
