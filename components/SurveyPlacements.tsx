'use client';
import { Camera, ImageOff } from 'lucide-react';
import SurveyPhotoStrip from '@/components/SurveyPhotoStrip';
import { placementRows } from '@/lib/surveys';
import type { CableDrop, Survey, SurveyCamera } from '@/lib/types';
import { scheduleKindFor } from '@/lib/types';

/**
 * Page 3 — a photo of the recommended spot for every device on the schedule.
 *
 * The photos live on the schedule rows themselves, so this is a focused view of
 * the same data rather than a second store: add a photo here and the camera row
 * has it too. What this page adds is the walk itself — one position at a time,
 * with a running count of what still has no picture.
 */
export default function SurveyPlacements({
  survey, folderKey, onCamerasChange, onDropsChange,
}: {
  survey: Pick<Survey, 'survey_type' | 'cameras' | 'cable_drops'>;
  folderKey: string;
  onCamerasChange: (next: SurveyCamera[]) => void;
  onDropsChange: (next: CableDrop[]) => void;
}) {
  const kind = scheduleKindFor(survey.survey_type ?? 'camera');
  const rows = placementRows(survey);
  const withPhoto = rows.filter((r) => r.photos.length > 0).length;

  const setPhotos = (id: string, photos: string[]) => {
    if (kind === 'cameras') {
      onCamerasChange((survey.cameras ?? []).map((c) => (c.id === id ? { ...c, photos } : c)));
    } else if (kind === 'drops') {
      onDropsChange((survey.cable_drops ?? []).map((d) => (d.id === id ? { ...d, photos } : d)));
    }
  };

  if (kind === 'none') {
    return (
      <div style={{ padding: '30px 20px', textAlign: 'center', color: '#aaa', fontSize: 13, border: '1px dashed #ddd', borderRadius: 10 }}>
        <ImageOff size={24} color="#ddd" style={{ marginBottom: 8 }} />
        <div>This survey type has no device schedule.</div>
        <div style={{ fontSize: 12, marginTop: 5 }}>Use the Documentation section on page 2 for site photos.</div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div style={{ padding: '30px 20px', textAlign: 'center', color: '#aaa', fontSize: 13, border: '1px dashed #ddd', borderRadius: 10 }}>
        <Camera size={24} color="#ddd" style={{ marginBottom: 8 }} />
        <div>Nothing to photograph yet.</div>
        <div style={{ fontSize: 12, marginTop: 5 }}>
          Add {kind === 'cameras' ? 'cameras' : 'drops'} on the Survey Details page first.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginBottom: 12,
        padding: '9px 12px', borderRadius: 10, background: 'rgba(13,115,119,0.06)', fontSize: 12, color: '#555',
      }}>
        <strong style={{ color: withPhoto === rows.length ? '#047857' : 'var(--teal)' }}>
          {withPhoto} of {rows.length} photographed
        </strong>
        {withPhoto < rows.length && (
          <span style={{ color: '#b45309' }}>
            {rows.length - withPhoto} still without a picture
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((r) => (
          <div
            key={r.id}
            style={{
              border: '1px solid #e8e8e8', borderRadius: 10, padding: 11,
              background: r.photos.length === 0 ? 'rgba(245,158,11,0.05)' : 'rgba(255,255,255,0.5)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
              <span style={{
                width: 26, height: 26, borderRadius: '50%', background: 'var(--teal)', color: 'white',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 800, flexShrink: 0,
              }}>{r.position}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{r.label}</div>
                {r.detail && <div style={{ fontSize: 12, color: '#888' }}>{r.detail}</div>}
              </div>
            </div>

            <SurveyPhotoStrip
              photos={r.photos} folderKey={folderKey}
              alt={`${r.label} recommended spot`} size={84} addLabel="Add photo"
              onChange={(photos) => setPhotos(r.id, photos)}
            />
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12, fontSize: 11, color: '#999', lineHeight: 1.5 }}>
        These photos travel with the survey and are what turn a line like
        &ldquo;Camera 2 — inside office hallway&rdquo; into something the client can picture.
      </div>
    </div>
  );
}
