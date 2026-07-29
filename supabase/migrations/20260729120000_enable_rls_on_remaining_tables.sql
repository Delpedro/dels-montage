ALTER TABLE cardio_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow all" ON cardio_logs;
CREATE POLICY "allow all" ON cardio_logs FOR ALL USING (true) WITH CHECK (true);
