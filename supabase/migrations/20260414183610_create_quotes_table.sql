CREATE TABLE IF NOT EXISTS quotes (
  id uuid default gen_random_uuid() primary key,
  quote text not null,
  author text,
  created_at timestamp default now()
);

ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow all" ON quotes FOR ALL USING (true) WITH CHECK (true);

INSERT INTO quotes (quote, author) VALUES
('Knowledge is King', NULL),
('The past can''t be changed', NULL),
('Your future is created by what you do today, not tomorrow', NULL),
('Expect Nothing. Blame Nobody. Do Something.', NULL),
('Doubt is a thief that often makes us fear to tread where we might have won', 'William Shakespeare'),
('Attitude not aptitude, determines altitude', 'Jesse Jackson'),
('Shoot for the moon. Even if you miss, you''ll land among the stars', NULL),
('The worst form of failure is failing to try', NULL),
('Be part of the solution, not part of the problem', NULL),
('The biggest room is the room for improvement', NULL),
('Excellence begins with the perfection of the basics', NULL),
('The harder you work, the luckier you get', NULL),
('Better to try and fail, than fail to try', NULL),
('It''s not what you''ve got but what you do with what you''ve got that matters', NULL),
('Happiness is a perfume. You cannot pour it on others without getting a few drops on yourself', 'Ralph Waldo Emerson'),
('Life''s not about waiting for the storm to pass. It''s about learning to dance in the rain', NULL),
('Everyone''s journey is different', NULL),
('Discipline is doing what needs to be done even when you don''t want to do it', NULL),
('You didn''t come this far to only come this far', NULL),
('Do something today that your future self will thank you for', NULL),
('Fall seven times, stand up eight', 'Japanese Proverb'),
('Take care of your body. It''s the only place you have to live', 'Jim Rohn'),
('Start from where you are. Work with what you have. Do what you can', NULL);