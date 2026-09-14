insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

create policy "Public can upload product images"
on storage.objects for insert
to anon, authenticated
with check (
  bucket_id = 'product-images'
  and (storage.extension(name) in ('jpg', 'jpeg', 'png', 'webp', 'gif'))
);

create policy "Public can view product images"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'product-images');