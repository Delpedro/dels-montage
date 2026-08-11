-- Supersets: two (or more) exercises performed back-to-back with no rest between them.
-- Rather than a new table, sets carry a per-workout group tag: every set of every exercise in
-- the same superset shares the same superset_group string ('1', '2', ... scoped to that workout).
-- null = an ordinary standalone exercise, which is every row that exists today.
alter table workout_sets add column if not exists superset_group text;
