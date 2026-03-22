-- Run this in your Supabase SQL editor
-- Tables for Event Confirmation and Location Voting

-- ═══ Confirmed Events ═══════════════════════════════════════════════════════
create table if not exists confirmed_events (
  id uuid default gen_random_uuid() primary key,
  week_start text not null unique,  -- one confirmed event per week
  slot_key text not null,
  confirmed_by text not null,
  created_at timestamptz default now()
);

alter table confirmed_events enable row level security;

create policy "Anyone can read confirmed_events"
  on confirmed_events for select using (true);
create policy "Anyone can insert confirmed_events"
  on confirmed_events for insert with check (true);
create policy "Anyone can update confirmed_events"
  on confirmed_events for update using (true);
create policy "Anyone can delete confirmed_events"
  on confirmed_events for delete using (true);

alter publication supabase_realtime add table confirmed_events;

-- ═══ Location Suggestions ═══════════════════════════════════════════════════
create table if not exists location_suggestions (
  id uuid default gen_random_uuid() primary key,
  week_start text not null,
  location text not null,
  suggested_by text not null,
  created_at timestamptz default now()
);

create unique index if not exists location_suggestions_user_week_unique
  on location_suggestions(week_start, suggested_by);

alter table location_suggestions enable row level security;

create policy "Anyone can read location_suggestions"
  on location_suggestions for select using (true);
create policy "Anyone can insert location_suggestions"
  on location_suggestions for insert with check (true);
create policy "Anyone can update location_suggestions"
  on location_suggestions for update using (true);
create policy "Anyone can delete location_suggestions"
  on location_suggestions for delete using (true);

alter publication supabase_realtime add table location_suggestions;

-- ═══ Location Votes ═════════════════════════════════════════════════════════
create table if not exists location_votes (
  id uuid default gen_random_uuid() primary key,
  suggestion_id uuid not null references location_suggestions(id) on delete cascade,
  user_name text not null,
  created_at timestamptz default now()
);

create unique index if not exists location_votes_unique
  on location_votes(suggestion_id, user_name);

alter table location_votes enable row level security;

create policy "Anyone can read location_votes"
  on location_votes for select using (true);
create policy "Anyone can insert location_votes"
  on location_votes for insert with check (true);
create policy "Anyone can delete location_votes"
  on location_votes for delete using (true);

alter publication supabase_realtime add table location_votes;
