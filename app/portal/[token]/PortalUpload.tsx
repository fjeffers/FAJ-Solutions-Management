'use client';
import { useState, useRef } from 'react';

interface UploadedFile {
  url: string;
  name: string;
  uploadedAt: number; // epoch ms
}

interface Props {
  woId: string;
  token: string;
  initialUrls?: string[];
}

export default function PortalUpload({ woId, token, initialUrls = [] }: Props) {
  // Extract upload timestamp from the Date.now() prefix in filename (e.g. "1716000000000.jpg")
  function tsFromUrl(url: string): number {
    const seg = url.split('/').pop() ?? '';
    const ts  = parseInt(seg.split('.')[0], 10);
    return isNaN(ts) ? 0 : ts;
  }

  const [files, setFiles] = useState<UploadedFile[]>(
    initialUrls.map((url) => ({ url, name: url.split('/').pop() ?? 'file', uploadedAt: tsFromUrl(url) })),
  );
  const [uploading, setUploading] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const inputRef                  = useRef<HTMLInputElement>(null);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setError(null);
    setUploading(true);

    for (const file of Array.from(fileList)) {
      try {
        const fd = new FormData();
        fd.append('token',  token);
        fd.append('wo_id',  woId);
        fd.append('file',   file);

        const res = await fetch('/api/portal/upload', { method: 'POST', body: fd });
        const data = await res.json();

        if (!res.ok || !data.url) throw new Error(data.error ?? 'Upload failed');

        setFiles((prev) => [...prev, { url: data.url, name: file.name, uploadedAt: Date.now() }]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
      }
    }

    setUploading(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  function isImage(url: string) {
    return /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i.test(url);
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 10 }}>
        📎 Photos &amp; Documents
      </div>

      {/* Drop zone / pick button */}
      <label
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          padding: '18px 12px',
          border: `2px dashed ${uploading ? '#9ca3af' : '#d1d5db'}`,
          borderRadius: 10,
          background: uploading ? '#f9fafb' : 'white',
          cursor: uploading ? 'wait' : 'pointer',
          transition: 'all 0.15s',
          marginBottom: 10,
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          handleFiles(e.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*,.pdf"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => handleFiles(e.target.files)}
          disabled={uploading}
        />
        <span style={{ fontSize: 22 }}>{uploading ? '⏳' : '📷'}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: uploading ? '#9ca3af' : '#374151' }}>
          {uploading ? 'Uploading…' : 'Tap to add photos or files'}
        </span>
        <span style={{ fontSize: 11, color: '#9ca3af' }}>
          JPG, PNG, HEIC, PDF • max 10 MB each
        </span>
      </label>

      {error && (
        <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 8 }}>{error}</div>
      )}

      {/* Uploaded files grid */}
      {files.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {files.map((f, i) => {
            const ts = f.uploadedAt > 0
              ? new Date(f.uploadedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
              : null;
            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <a
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ textDecoration: 'none', display: 'block' }}
                >
                  {isImage(f.url) ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={f.url}
                      alt={f.name}
                      style={{
                        width: '100%',
                        aspectRatio: '1',
                        objectFit: 'cover',
                        borderRadius: 8,
                        border: '1px solid #e5e7eb',
                        display: 'block',
                      }}
                    />
                  ) : (
                    <div style={{
                      width: '100%',
                      aspectRatio: '1',
                      borderRadius: 8,
                      border: '1px solid #e5e7eb',
                      background: '#f3f4f6',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                      padding: 4,
                    }}>
                      <span style={{ fontSize: 22 }}>📄</span>
                      <span style={{ fontSize: 9, color: '#6b7280', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '90%' }}>
                        {f.name}
                      </span>
                    </div>
                  )}
                </a>
                {ts && (
                  <span style={{ fontSize: 9, color: '#9ca3af', textAlign: 'center', lineHeight: 1.2 }}>
                    {ts}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
