'use client';
import { useState } from 'react';
import {
  ChevronLeft, ChevronRight, Check, Plus, SkipForward, ListChecks, Camera, Cable,
} from 'lucide-react';
import {
  scriptFor, isAnswered, guideProgress, devicesComplete, seedFromPrevious,
  type GuideStep,
} from '@/lib/survey-guide';
import { newCamera, newDrop, renumber } from '@/lib/surveys';
import SurveyPhotoStrip from '@/components/SurveyPhotoStrip';
import SurveyPhotoRead from '@/components/SurveyPhotoRead';
import { fmtMoney } from '@/lib/utils';
import type { CableDrop, SurveyCamera } from '@/lib/types';

type Device = SurveyCamera | CableDrop;

/**
 * The guided walk-through: one question at a time, big tappable answers, and a
 * running "3 of 7 done" — the way the job is actually recorded standing in a
 * building, rather than a table of fields you have to already understand.
 *
 * It edits the SAME rows as the table view. Switch between them freely; this is
 * a different way of asking, not a different place to store.
 */
export default function SurveyGuide({
  kind, devices, folderKey, onChange, onSwitchToTable,
}: {
  kind: 'cameras' | 'drops';
  devices: Device[];
  folderKey: string;
  onChange: (next: Device[]) => void;
  onSwitchToTable: () => void;
}) {
  const script = scriptFor(kind);
  const noun = kind === 'drops' ? 'drop' : 'camera';

  const [index, setIndex] = useState(0);   // which device
  const [stepAt, setStepAt] = useState(0); // which question

  const progress = guideProgress(devices as unknown as Record<string, unknown>[], script);
  const done = devicesComplete(devices as unknown as Record<string, unknown>[], script);

  const addDevice = () => {
    const fresh = (kind === 'drops' ? newDrop(devices.length + 1) : newCamera(devices.length + 1)) as Device;
    const seeded = seedFromPrevious(
      fresh as unknown as Record<string, unknown>,
      devices[devices.length - 1] as unknown as Record<string, unknown> | undefined,
      script,
    ) as unknown as Device;
    onChange(renumber([...devices, seeded] as never));
    setIndex(devices.length);
    setStepAt(0);
  };

  // Nothing to walk yet.
  if (devices.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '34px 20px', border: '1px dashed #ddd', borderRadius: 14 }}>
        {kind === 'drops'
          ? <Cable size={28} color="#ddd" style={{ marginBottom: 10 }} />
          : <Camera size={28} color="#ddd" style={{ marginBottom: 10 }} />}
        <div className="serif" style={{ fontSize: 20, marginBottom: 6 }}>Let&apos;s walk the site.</div>
        <p style={{ color: '#777', fontSize: 13, margin: '0 0 18px', lineHeight: 1.6 }}>
          I&apos;ll ask about each {noun} one at a time — where it goes, how it mounts,
          how much cable, what it&apos;s worth. Answer as you walk.
        </p>
        <button className="btn btn-primary" onClick={addDevice}>
          <Plus size={14} /> Start with {noun} 1
        </button>
      </div>
    );
  }

  const device = devices[index] as unknown as Record<string, unknown>;
  const step = script[stepAt];
  const position = Number(device.position) || index + 1;
  const lastStep = stepAt === script.length - 1;

  const answer = (value: unknown) => {
    onChange(devices.map((d, i) => (i === index ? { ...(d as object), [step.field]: value } as Device : d)));
  };

  const next = () => {
    if (!lastStep) { setStepAt(stepAt + 1); return; }
    // Finished this device: move to the next one, or offer to add another.
    if (index < devices.length - 1) { setIndex(index + 1); setStepAt(0); }
  };

  const back = () => {
    if (stepAt > 0) { setStepAt(stepAt - 1); return; }
    if (index > 0) { setIndex(index - 1); setStepAt(script.length - 1); }
  };

  const answered = isAnswered(device, step);
  const canAdvance = answered || step.optional;
  const atVeryEnd = lastStep && index === devices.length - 1;

  return (
    <div>
      {/* Progress — "3 of 7 done" is the line from the field, and it belongs here. */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--teal)' }}>
            {done} of {devices.length} {noun}{devices.length !== 1 ? 's' : ''} done
          </div>
          <button
            onClick={onSwitchToTable}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 5 }}
          >
            <ListChecks size={12} /> See them all as a table
          </button>
        </div>
        <div style={{ height: 5, borderRadius: 999, background: '#eee9df', overflow: 'hidden' }}>
          <div style={{
            width: `${progress.percent}%`, height: '100%', borderRadius: 999,
            background: 'linear-gradient(90deg, #0D7377, #14b8b8)', transition: 'width 0.25s',
          }} />
        </div>
      </div>

      {/* Which device, and how to jump between them */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {devices.map((d, i) => {
          const p = Number((d as unknown as Record<string, unknown>).position) || i + 1;
          const complete = script.filter((s) => !s.optional)
            .every((s) => isAnswered(d as unknown as Record<string, unknown>, s));
          const active = i === index;
          return (
            <button
              key={(d as { id: string }).id}
              onClick={() => { setIndex(i); setStepAt(0); }}
              title={String((d as unknown as Record<string, unknown>).location || `${noun} ${p}`)}
              style={{
                width: 34, height: 34, borderRadius: '50%', cursor: 'pointer',
                fontSize: 12, fontWeight: 800,
                border: active ? '2px solid var(--teal)' : '1px solid #e2ddd2',
                background: complete ? '#047857' : active ? 'rgba(13,115,119,0.10)' : 'white',
                color: complete ? 'white' : active ? 'var(--teal)' : '#999',
              }}
            >{complete ? <Check size={13} /> : p}</button>
          );
        })}
        <button
          onClick={addDevice} title={`Add another ${noun}`}
          style={{
            width: 34, height: 34, borderRadius: '50%', cursor: 'pointer',
            border: '1px dashed #cfcabb', background: 'white', color: 'var(--teal)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        ><Plus size={15} /></button>
      </div>

      {/* The question */}
      <div style={{
        border: '1px solid #eee9df', borderRadius: 14, padding: '20px 20px 18px',
        background: 'white', boxShadow: '0 2px 14px rgba(13,115,119,0.05)',
      }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.2, color: '#bbb', textTransform: 'uppercase', marginBottom: 7 }}>
          Question {stepAt + 1} of {script.length}
          {step.optional && ' · optional'}
        </div>
        <div className="serif" style={{ fontSize: 22, lineHeight: 1.3, marginBottom: step.hint ? 6 : 16 }}>
          {step.prompt(position)}
        </div>
        {step.hint && (
          <div style={{ fontSize: 12, color: '#999', marginBottom: 16 }}>{step.hint}</div>
        )}

        <AnswerControl
          step={step} device={device} folderKey={folderKey}
          position={position} noun={noun} onAnswer={answer}
          onAcceptSuggestion={(patch) =>
            onChange(devices.map((d, i) => (i === index ? { ...d, ...patch } as Device : d)))}
        />
      </div>

      {/* Move */}
      <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          className="btn btn-ghost" onClick={back}
          disabled={stepAt === 0 && index === 0}
          style={{ opacity: stepAt === 0 && index === 0 ? 0.4 : 1 }}
        ><ChevronLeft size={14} /> Back</button>

        <div style={{ flex: 1 }} />

        {step.optional && !answered && (
          <button className="btn btn-ghost" onClick={next} style={{ color: '#999' }}>
            <SkipForward size={13} /> Skip
          </button>
        )}

        {atVeryEnd ? (
          <button className="btn btn-primary" onClick={addDevice} disabled={!canAdvance}>
            <Plus size={14} /> Add another {noun}
          </button>
        ) : (
          <button className="btn btn-primary" onClick={next} disabled={!canAdvance}>
            Next <ChevronRight size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── The answer control for one question ─────────────────────────────────────

function AnswerControl({
  step, device, folderKey, position, noun, onAnswer, onAcceptSuggestion,
}: {
  step: GuideStep;
  device: Record<string, unknown>;
  folderKey: string;
  position: number;
  noun: string;
  onAnswer: (v: unknown) => void;
  /** Photo suggestions fill fields other than the one being asked about. */
  onAcceptSuggestion: (patch: Record<string, string>) => void;
}) {
  const value = device[step.field];

  if (step.kind === 'photo') {
    const photos = (value as string[]) ?? [];
    return (
      <div>
        <SurveyPhotoStrip
          photos={photos} folderKey={folderKey}
          alt={`${noun} ${position} location`} size={84} addLabel="Take photo"
          onChange={(next) => onAnswer(next)}
        />
        <SurveyPhotoRead
          photoUrl={photos[0]}
          position={position}
          noun={noun === 'drop' ? 'drop' : 'camera'}
          onAccept={onAcceptSuggestion}
        />
      </div>
    );
  }

  if (step.kind === 'money' || step.kind === 'number') {
    const n = Number(value) || 0;
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {step.kind === 'money' && <span style={{ fontSize: 24, color: '#bbb', fontWeight: 600 }}>$</span>}
          <input
            className="input" type="number" step={step.kind === 'money' ? '0.01' : '1'}
            min={0} inputMode="decimal" autoFocus
            value={n || ''} placeholder={step.placeholder}
            onChange={(e) => onAnswer(Number(e.target.value) || 0)}
            style={{ fontSize: 20, fontWeight: 700, maxWidth: 220 }}
          />
        </div>
        {step.kind === 'money' && n > 0 && (
          <div style={{ fontSize: 12, color: '#047857', marginTop: 7, fontWeight: 600 }}>
            {fmtMoney(n)}
          </div>
        )}
      </div>
    );
  }

  const chips = step.options ?? [];
  const isChosen = (opt: string) => String(value ?? '') === opt;

  return (
    <div>
      {chips.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: step.kind === 'chips-or-text' ? 12 : 0 }}>
          {chips.map((opt) => (
            <button
              key={opt} onClick={() => onAnswer(opt)}
              style={{
                padding: '10px 16px', borderRadius: 999, cursor: 'pointer',
                fontSize: 13, fontWeight: 600, lineHeight: 1.2,
                border: isChosen(opt) ? '1px solid var(--teal)' : '1px solid #e2ddd2',
                background: isChosen(opt) ? 'var(--teal)' : 'white',
                color: isChosen(opt) ? 'white' : '#555',
                transition: 'all 0.12s',
              }}
            >{opt}</button>
          ))}
        </div>
      )}

      {(step.kind === 'text' || step.kind === 'chips-or-text') && (
        <input
          className="input" value={typeof value === 'string' ? value : ''}
          placeholder={step.placeholder} autoFocus={chips.length === 0}
          onChange={(e) => onAnswer(e.target.value)}
          style={{ fontSize: 15 }}
        />
      )}
    </div>
  );
}
