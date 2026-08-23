-- The deletion request row is the audit trail proving an erasure request was
-- fulfilled. It must not vanish when the user row it references is deleted
-- as part of that same erasure (the original `on delete cascade` FK would
-- silently delete this row too, destroying the very record compliance
-- needs). Make user_id nullable and set-null on delete instead.

alter table data_subject_requests
  alter column user_id drop not null;

alter table data_subject_requests
  drop constraint data_subject_requests_user_id_fkey,
  add constraint data_subject_requests_user_id_fkey
    foreign key (user_id) references users(id) on delete set null;
