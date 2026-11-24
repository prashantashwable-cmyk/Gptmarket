-- Hindi and Marathi versions of AIEC's own package texts. English stays mandatory; a missing
-- translation falls back to English on screen. Frozen with the rest of a published version.
alter table package_versions
  add column title_hi text check (title_hi is null or length(title_hi) between 2 and 120),
  add column title_mr text check (title_mr is null or length(title_mr) between 2 and 120),
  add column summary_hi text, add column summary_mr text,
  add column features_hi text, add column features_mr text,
  add column exclusions_hi text, add column exclusions_mr text;
