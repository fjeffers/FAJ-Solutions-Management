// Uploads for the survey: the documentation panel and each camera's photos of
// its recommended mounting area both land in the same bucket through here.
//
// The folder key is generated when the survey modal opens rather than taken
// from the survey id, so photos can be taken on a survey that has never been
// saved — which is the normal case standing in a building with a phone.
import { createClient } from '@/lib/supabase/client';

const BUCKET = 'survey-docs';

export function newFolderKey(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Storage-safe object name; the original file name is kept in the record. */
export function storagePath(folderKey: string, fileName: string): string {
  const safe = fileName.replace(/[^\w.\-]+/g, '_');
  return `${folderKey}/${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${safe}`;
}

export type UploadResult = { url: string; file: File };

/**
 * Upload one file and return its public URL. Throws with the storage message
 * so callers can name the file that failed.
 */
export async function uploadSurveyFile(folderKey: string, file: File): Promise<string> {
  const supabase = createClient();
  const path = storagePath(folderKey, file.name);
  const { error } = await supabase.storage.from(BUCKET).upload(path, file);
  if (error) throw new Error(error.message);
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Remove a stored object given the public URL it was served from. Best effort:
 * a failed delete must never block removing the record that points at it,
 * otherwise a survey keeps a row for a file the user already dismissed.
 */
export async function deleteSurveyFile(url: string): Promise<void> {
  const marker = `/${BUCKET}/`;
  const i = url.indexOf(marker);
  if (i < 0) return;
  const path = decodeURIComponent(url.slice(i + marker.length));
  const supabase = createClient();
  await supabase.storage.from(BUCKET).remove([path]);
}
