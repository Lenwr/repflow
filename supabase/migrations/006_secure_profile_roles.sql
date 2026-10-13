-- Un utilisateur peut modifier son nom et son avatar, mais pas s'accorder
-- lui-même le rôle coach/client. Les fonctions security definer (comme
-- accept_coach_invite) continuent de pouvoir changer le rôle.
revoke update on table public.profiles from authenticated;
grant update (display_name, avatar_url) on table public.profiles to authenticated;
grant select on table public.profiles to authenticated;
