import type { SupabaseClient } from '@supabase/supabase-js';
import { db } from '../db';
import { PHOTO_BUCKET } from '../sync/supabaseRemote';

/**
 * View-only access. The server decides what a viewer may see: these functions return only
 * the allowed columns (see supabase/schema-expo.sql). Nothing here is stored on the device.
 */
export interface SharedCompany {
  id: string;
  owner_id: string;
  code: string;
  company_name: string;
  brand: string;
  bearing_types: string[];
  bearing_types_other: string;
  hall: string;
  booth: string;
  contact_person: string;
  wechat_id: string;
  whatsapp: string;
  phone: string;
  email: string;
  website: string;
  rating: number | null;
  notes: string;
  updated_at: string;
}

export interface SharedPhoto {
  id: string;
  owner_id: string;
  supplier_id: string;
  kind: string;
  width: number;
  height: number;
  created_at: string;
}

export interface ViewerEntry {
  viewer_id: string;
  viewer_email: string;
  watermark: string;
  locked_at: string | null;
  created_at: string;
}

/** Lock this account to this device on first use. 'locked' = already in use on another device. */
export async function claimDevice(client: SupabaseClient): Promise<'ok' | 'locked' | 'not_viewer' | 'no_session'> {
  const { data, error } = await client.rpc('expo_viewer_claim');
  if (error) throw new Error(error.message);
  return data as 'ok' | 'locked' | 'not_viewer' | 'no_session';
}

export async function unlockViewer(client: SupabaseClient, viewerId: string) {
  const { error } = await client.rpc('expo_unlock_viewer', { p_viewer: viewerId });
  if (error) throw new Error(error.message);
}

/** The watermark text the owner chose for this viewer (falls back to the email). */
export async function myWatermark(client: SupabaseClient): Promise<string> {
  const uid = await currentUserId(client);
  if (!uid) return '';
  const { data } = await client.from('expo_viewers').select('watermark').eq('viewer_id', uid).limit(1);
  return ((data ?? [])[0] as { watermark?: string } | undefined)?.watermark?.trim() ?? '';
}

export async function currentUserId(client: SupabaseClient): Promise<string | null> {
  const { data } = await client.auth.getSession();
  return data.session?.user?.id ?? null;
}

/** true if the signed-in account is a view-only account for someone */
export async function checkIsViewer(client: SupabaseClient): Promise<boolean> {
  const uid = await currentUserId(client);
  if (!uid) return false;
  const { data, error } = await client.from('expo_viewers').select('owner_id').eq('viewer_id', uid).limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

export async function fetchShared(client: SupabaseClient): Promise<{ companies: SharedCompany[]; photos: SharedPhoto[] }> {
  const [c, p] = await Promise.all([client.rpc('expo_shared_companies'), client.rpc('expo_shared_photos')]);
  if (c.error) throw new Error(c.error.message);
  if (p.error) throw new Error(p.error.message);
  return { companies: (c.data ?? []) as SharedCompany[], photos: (p.data ?? []) as SharedPhoto[] };
}

export async function downloadSharedPhoto(client: SupabaseClient, ownerId: string, photoId: string): Promise<Blob> {
  const { data, error } = await client.storage.from(PHOTO_BUCKET).download(`${ownerId}/${photoId}.jpg`);
  if (error || !data) throw new Error(error?.message || 'Photo not available');
  return data;
}

// ----- owner side -----
export async function listViewers(client: SupabaseClient): Promise<ViewerEntry[]> {
  const uid = await currentUserId(client);
  if (!uid) return [];
  const { data, error } = await client.from('expo_viewers').select('viewer_id, viewer_email, watermark, locked_at, created_at').eq('owner_id', uid).order('created_at');
  if (error) throw new Error(error.message);
  return (data ?? []) as ViewerEntry[];
}

export async function addViewer(client: SupabaseClient, email: string, watermark: string) {
  const { error } = await client.rpc('expo_add_viewer', { p_email: email, p_watermark: watermark });
  if (error) throw new Error(error.message);
}

export async function setViewerWatermark(client: SupabaseClient, viewerId: string, watermark: string) {
  const { error } = await client.rpc('expo_set_viewer_watermark', { p_viewer: viewerId, p_watermark: watermark });
  if (error) throw new Error(error.message);
}

export async function removeViewer(client: SupabaseClient, viewerId: string) {
  const { error } = await client.rpc('expo_remove_viewer', { p_viewer: viewerId });
  if (error) throw new Error(error.message);
}

/** A view-only phone must not keep any app data: clear everything stored locally. */
export async function wipeLocalData() {
  await Promise.all([db.suppliers.clear(), db.products.clear(), db.quotations.clear(), db.photos.clear(), db.photoBlobs.clear(), db.conflicts.clear(), db.syncLog.clear()]);
}
