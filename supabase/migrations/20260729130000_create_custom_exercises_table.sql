CREATE TABLE IF NOT EXISTS custom_exercises (
  id uuid default gen_random_uuid() primary key,
  name text not null unique,
  created_at timestamp default now()
);

ALTER TABLE custom_exercises ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow all" ON custom_exercises FOR ALL USING (true) WITH CHECK (true);
