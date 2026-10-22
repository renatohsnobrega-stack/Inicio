-- Compras: ledger idempotente, limpeza concorrente de itens e recibos privados.
-- Aplicar somente depois de schema.sql, que define public.registros e public.is_membro().
begin;

create or replace function public.finalize_purchase(p_purchase jsonb, p_sources jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_id text;
  v_existing jsonb;
  v_source jsonb;
  v_current jsonb;
  v_source_id text;
  v_source_count integer;
begin
  if auth.uid() is null or not public.is_membro() then
    raise exception 'Acesso negado: somente membro autenticado pode finalizar compras' using errcode = '42501';
  end if;
  if jsonb_typeof(p_purchase) <> 'object' or jsonb_typeof(p_sources) <> 'array' then
    raise exception 'Compra ou snapshot de itens inválido';
  end if;
  v_id := nullif(p_purchase->>'id', '');
  if v_id is null then raise exception 'A compra precisa de um id'; end if;
  if coalesce(p_purchase->>'kind', 'compra') <> 'compra' then
    raise exception 'Tipo de registro inválido para compra';
  end if;
  if jsonb_typeof(coalesce(p_purchase->'itens', 'null'::jsonb)) <> 'array' then
    raise exception 'A compra precisa conter uma lista de itens';
  end if;
  v_source_count := jsonb_array_length(p_sources);
  if v_source_count < 1 or v_source_count <> jsonb_array_length(p_purchase->'itens') then
    raise exception 'A compra deve conter exatamente os itens selecionados para baixa';
  end if;
  if (select count(distinct value->>'itemId') from jsonb_array_elements(p_purchase->'itens')) <> v_source_count then
    raise exception 'A compra contém itens repetidos ou sem itemId';
  end if;
  if (select count(distinct value->>'id') from jsonb_array_elements(p_sources)) <> v_source_count then
    raise exception 'A seleção contém fontes repetidas ou sem id';
  end if;

  -- Mesmo purchase id serializa reenvios; linhas de origem são bloqueadas abaixo.
  perform pg_advisory_xact_lock(hashtextextended('compra:' || v_id, 0));
  select r.data into v_existing from public.registros r
   where r.kind = 'compra' and r.id = v_id for update;
  if found then
    if (v_existing - 'nota') = (p_purchase - 'nota') then
      return v_existing; -- reenvio após commit: não reapaga nem sobrescreve ledger/anexo.
    end if;
    raise exception 'Já existe uma compra finalizada com este id e dados diferentes';
  end if;

  -- Primeiro valida e bloqueia todos snapshots, em ordem estável; qualquer conflito aborta tudo.
  for v_source in
    select value from jsonb_array_elements(p_sources)
     order by coalesce(value->>'id', value->'snapshot'->>'id', '')
  loop
    v_source_id := coalesce(nullif(v_source->>'id', ''), nullif(v_source->'snapshot'->>'id', ''));
    if v_source_id is null or jsonb_typeof(v_source->'snapshot') <> 'object' then
      raise exception 'Snapshot de item inválido (id e objeto snapshot são obrigatórios)';
    end if;
    if v_source->'snapshot' ? 'feito' and v_source->'snapshot'->>'feito' is distinct from 'true' then
      raise exception 'O item % não está marcado para compra', v_source_id;
    end if;
    if v_source->'snapshot'->>'lista' is distinct from p_purchase->>'lista' then
      raise exception 'O item % não pertence à lista desta compra', v_source_id;
    end if;
    if not exists (select 1 from jsonb_array_elements(p_purchase->'itens') i where i->>'itemId' = v_source_id) then
      raise exception 'O item % não está incluído nesta compra', v_source_id;
    end if;
    select r.data into v_current from public.registros r
     where r.kind = 'item' and r.id = v_source_id for update;
    if not found then raise exception 'O item % não está mais ativo; atualize a lista e tente novamente', v_source_id; end if;
    if v_current is distinct from v_source->'snapshot' then
      raise exception 'O item % mudou desde a seleção; atualize a lista antes de finalizar', v_source_id;
    end if;
  end loop;

  insert into public.registros(kind, id, data)
    values ('compra', v_id, p_purchase);

  for v_source in select value from jsonb_array_elements(p_sources) loop
    v_source_id := coalesce(nullif(v_source->>'id', ''), v_source->'snapshot'->>'id');
    delete from public.registros r
     where r.kind = 'item' and r.id = v_source_id and r.data = v_source->'snapshot';
  end loop;
  return p_purchase;
end $$;

create or replace function public.attach_purchase_receipt(p_id text, p_nota jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_data jsonb;
  v_path text;
  v_ext text;
  v_type text;
  v_size bigint;
begin
  if auth.uid() is null or not public.is_membro() then
    raise exception 'Acesso negado: somente membro autenticado pode anexar nota' using errcode = '42501';
  end if;
  if jsonb_typeof(p_nota) <> 'object' then raise exception 'Metadados da nota inválidos'; end if;
  v_path := p_nota->>'path';
  v_type := p_nota->>'type';
  v_size := (p_nota->>'size')::bigint;
  if v_size is null or v_size < 1 or v_size > 8388608 then raise exception 'A nota deve ter até 8 MB'; end if;
  if coalesce(p_nota->>'nome', '') = '' or length(p_nota->>'nome') > 255 then raise exception 'Nome do arquivo inválido'; end if;
  if v_path is null or left(v_path, length('familia/' || p_id || '/')) <> 'familia/' || p_id || '/' then
    raise exception 'Caminho de nota inválido';
  end if;
  if v_path !~* '^familia/[^/]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|pdf)$' then
    raise exception 'Caminho de nota inválido';
  end if;
  v_ext := lower(regexp_replace(v_path, '^.*\.', ''));
  if not ((v_ext in ('jpg','jpeg') and v_type = 'image/jpeg') or
          (v_ext = 'png' and v_type = 'image/png') or
          (v_ext = 'webp' and v_type = 'image/webp') or
          (v_ext = 'pdf' and v_type = 'application/pdf')) then
    raise exception 'Tipo de arquivo ou extensão inválidos';
  end if;
  if (p_nota - 'path' - 'nome' - 'type' - 'size') <> '{}'::jsonb then
    raise exception 'Metadados da nota contêm campos não permitidos';
  end if;

  select r.data into v_data from public.registros r
   where r.kind = 'compra' and r.id = p_id for update;
  if not found then raise exception 'Compra não encontrada'; end if;
  if v_data ? 'nota' then raise exception 'Esta compra já tem uma nota anexada'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'notas-compras' and o.name = v_path) then
    raise exception 'O arquivo enviado não foi encontrado no bucket privado';
  end if;
  v_data := v_data || jsonb_build_object('nota', p_nota);
  update public.registros set data = v_data where kind = 'compra' and id = p_id;
  return v_data;
end $$;

-- Permite ao cliente remover só um upload órfão após erro de attach; nunca apaga um objeto
-- que já esteja referenciado pelo ledger. O path também fica preso à compra dada.
create or replace function public.purchase_receipt_path_unattached(p_id text, p_path text)
returns boolean
language plpgsql
security definer
stable
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.is_membro() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if left(coalesce(p_path, ''), length('familia/' || p_id || '/')) <> 'familia/' || p_id || '/' then
    return false;
  end if;
  return not exists (
    select 1 from public.registros r
     where r.kind = 'compra' and r.id = p_id and r.data->'nota'->>'path' = p_path
  );
end $$;

revoke all on function public.finalize_purchase(jsonb, jsonb) from public, anon;
revoke all on function public.attach_purchase_receipt(text, jsonb) from public, anon;
revoke all on function public.purchase_receipt_path_unattached(text, text) from public, anon;
grant execute on function public.finalize_purchase(jsonb, jsonb),
  public.attach_purchase_receipt(text, jsonb),
  public.purchase_receipt_path_unattached(text, text) to authenticated;

-- Recibos permanecem privados. Supabase Storage aplica tamanho/MIME no bucket e as políticas
-- limitam todos os objetos deste bucket ao prefixo familia/ e a membros autenticados.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('notas-compras', 'notas-compras', false, 8388608,
        array['image/jpeg','image/png','image/webp','application/pdf']::text[])
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- storage.objects já tem RLS habilitada pelo Supabase; não altere a tabela gerenciada.
drop policy if exists "membros leem recibos de compras" on storage.objects;
drop policy if exists "membros enviam recibos de compras" on storage.objects;
drop policy if exists "membros apagam recibos de compras" on storage.objects;
create policy "membros leem recibos de compras" on storage.objects
  for select to authenticated
  using (bucket_id = 'notas-compras' and (storage.foldername(name))[1] = 'familia' and public.is_membro());
create policy "membros enviam recibos de compras" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'notas-compras' and (storage.foldername(name))[1] = 'familia' and public.is_membro());
create policy "membros apagam recibos de compras" on storage.objects
  for delete to authenticated
  using (bucket_id = 'notas-compras' and (storage.foldername(name))[1] = 'familia' and public.is_membro());

notify pgrst, 'reload schema';
commit;
