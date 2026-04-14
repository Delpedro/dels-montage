CREATE TABLE quotes (
  id uuid default gen_random_uuid() primary key,
  quote text not null,
  author text,
  created_at timestamp default now()
);

ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow all" ON quotes FOR ALL USING (true) WITH CHECK (true);