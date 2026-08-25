// The part of the quote that shows the client WHERE the work goes.
//
// A line that reads "Camera 2 — Inside office hallway · Dome, ceiling mount,
// tinted cover · 30 ft cable" is precise but abstract. Paired with the photo
// taken standing under that spot on the walk-through, it stops being a promise
// and becomes a plan. That is the whole reason the surveyor takes the picture.
//
// Server-rendered from the survey linked to this quote (quotes.survey_id).
// Photos come from the public survey-docs bucket, so they load for a client
// who has no login and only a share link.
import { placementRows } from '@/lib/surveys';
import type { Survey } from '@/lib/types';
import { scheduleKindFor } from '@/lib/types';

export default function QuotePlacements({ survey }: { survey: Survey }) {
  const rows = placementRows(survey);
  const withPhotos = rows.filter((r) => r.photos.length > 0);

  // Nothing to show is not a section worth printing an empty header for.
  if (rows.length === 0) return null;

  const kind = scheduleKindFor(survey.survey_type ?? 'camera');
  const noun = kind === 'drops' ? 'Drop' : 'Camera';
  const heading = kind === 'drops' ? 'Proposed Drop Locations' : 'Proposed Camera Placements';

  return (
    <section style={{ marginTop: 30, borderTop: '1px solid #f0ede6', paddingTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
        <h2 className="serif" style={{ fontSize: 22, fontWeight: 600, margin: 0, color: '#123' }}>
          {heading}
        </h2>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: '#0D7377' }}>
          {rows.length} {noun.toUpperCase()}{rows.length !== 1 ? 'S' : ''}
        </div>
      </div>

      <p style={{ fontSize: 13, color: '#666', margin: '0 0 18px', lineHeight: 1.6 }}>
        {withPhotos.length > 0
          ? `Photographed on site during the walk-through${survey.survey_date ? ` on ${fmtDay(survey.survey_date)}` : ''}. Each position below is the recommended location for that ${noun.toLowerCase()}.`
          : `Each position below is the recommended location for that ${noun.toLowerCase()}.`}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
        {rows.map((r) => (
          <figure
            key={r.id}
            style={{
              margin: 0, border: '1px solid #eae5db', borderRadius: 14, overflow: 'hidden',
              background: 'white', breakInside: 'avoid', pageBreakInside: 'avoid',
            }}
          >
            {r.photos.length > 0 ? (
              <div style={{ position: 'relative', background: '#f4f1ea' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={r.photos[0]}
                  alt={`${r.label} — recommended location`}
                  style={{ width: '100%', height: 180, objectFit: 'cover', display: 'block' }}
                />
                <span style={{
                  position: 'absolute', top: 10, left: 10,
                  minWidth: 30, height: 30, padding: '0 9px', borderRadius: 999,
                  background: 'rgba(13,115,119,0.95)', color: 'white',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 800, letterSpacing: 0.5,
                  boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
                }}>
                  {r.position}
                </span>
                {r.photos.length > 1 && (
                  <span style={{
                    position: 'absolute', bottom: 10, right: 10, borderRadius: 6,
                    background: 'rgba(0,0,0,0.55)', color: 'white',
                    fontSize: 10, fontWeight: 700, padding: '3px 7px',
                  }}>
                    +{r.photos.length - 1} more
                  </span>
                )}
              </div>
            ) : (
              // No photo for this position — say so plainly rather than
              // showing a broken frame or silently dropping the position.
              <div style={{
                height: 84, background: '#f7f5ef', display: 'flex', alignItems: 'center', gap: 10,
                padding: '0 14px', borderBottom: '1px solid #f0ede6',
              }}>
                <span style={{
                  minWidth: 30, height: 30, borderRadius: 999, background: '#0D7377', color: 'white',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 800,
                }}>{r.position}</span>
                <span style={{ fontSize: 11, color: '#a09880' }}>Location confirmed on site</span>
              </div>
            )}

            <figcaption style={{ padding: '12px 14px 14px' }}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.3, color: '#C9A961' }}>
                {noun.toUpperCase()} {r.position}
              </div>
              <div style={{ fontWeight: 700, fontSize: 14, marginTop: 2, lineHeight: 1.35, color: '#123' }}>
                {primaryOf(r.detail) || r.label}
              </div>
              {secondaryOf(r.detail) && (
                <div style={{ fontSize: 12, color: '#777', marginTop: 3, lineHeight: 1.5 }}>
                  {secondaryOf(r.detail)}
                </div>
              )}
            </figcaption>
          </figure>
        ))}
      </div>

      {/* The head-end is the other half of a camera job and clients rarely see
          it costed anywhere, so it is worth stating plainly. */}
      {(survey.head_end_notes || survey.rack_space || survey.switch_notes) && (
        <div style={{
          marginTop: 18, background: '#f8f6f1', borderRadius: 12, padding: '14px 16px',
          fontSize: 13, color: '#555', lineHeight: 1.6, breakInside: 'avoid',
        }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.4, color: '#8a6d2f', marginBottom: 5 }}>
            HEAD-END &amp; EQUIPMENT
          </div>
          {survey.head_end_notes && <div>{survey.head_end_notes}</div>}
          {(survey.rack_space || survey.switch_notes) && (
            <div style={{ marginTop: 5, color: '#777', fontSize: 12 }}>
              {survey.rack_space && <>Rack space available: <b>{survey.rack_space}</b></>}
              {survey.rack_space && survey.switch_notes && ' · '}
              {survey.switch_notes && <>Switch: <b>{survey.switch_notes}</b></>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** The detail string is "Location · Type · mount"; the location leads. */
function primaryOf(detail: string): string {
  return detail.split(' · ')[0] ?? '';
}
function secondaryOf(detail: string): string {
  return detail.split(' · ').slice(1).join(' · ');
}

function fmtDay(d: string): string {
  return new Date(d.split('T')[0] + 'T12:00:00')
    .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}
