-- WhenToPlan Supabase Schema
-- Run this in your Supabase SQL editor

-- Create availabilities table
create table if not exists availabilities (
  id uuid default gen_random_uuid() primary key,
  user_name text not null,
  slot_key text not null,   -- format: "YYYY-MM-DD_HH"
  created_at timestamptz default now()
);

-- Index for fast lookups by slot_key
create index if not exists availabilities_slot_key_idx on availabilities(slot_key);

-- Index for fast lookups by user_name
create index if not exists availabilities_user_name_idx on availabilities(user_name);

-- Unique constraint: one entry per user per slot
create unique index if not exists availabilities_user_slot_unique
  on availabilities(user_name, slot_key);

-- Enable Row Level Security
alter table availabilities enable row level security;

-- Allow anyone to read all availabilities (public group planner)
create policy "Anyone can read availabilities"
  on availabilities for select
  using (true);

-- Allow anyone to insert availabilities
create policy "Anyone can insert availabilities"
  on availabilities for insert
  with check (true);

-- Allow users to delete only their own availabilities
create policy "Users can delete own availabilities"
  on availabilities for delete
  using (true);

-- Enable realtime on this table
alter publication supabase_realtime add table availabilities;
