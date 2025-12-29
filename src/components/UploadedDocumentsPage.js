import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import supabase from '../lib/supabaseClient';

const mapDocumentRow = (row) => ({
  id: row?.id || row?.storage_path || row?.file_name,
  name: row?.original_name || row?.file_name || 'Document',
  path: row?.storage_path || row?.file_name || '',
  url: row?.public_url || null,
  size: row?.size_bytes || null,
  lastModified: row?.uploaded_at || row?.updated_at || null,
  type: row?.mime_type || 'application/octet-stream',
  status: row?.extraction_status || 'pending',
  summary: row?.extraction_summary || null,
  extractedText: row?.extracted_text || null
});

const UploadedDocumentsPage = () => {
  const navigate = useNavigate();
  const [previousUploads, setPreviousUploads] = useState([]);
  const [previousUploadsLoading, setPreviousUploadsLoading] = useState(true);
  const [expandedDocId, setExpandedDocId] = useState(null);

  const loadPersistedDocuments = useCallback(async () => {
    setPreviousUploadsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const uid = user?.id;
      if (!uid) {
        setPreviousUploads([]);
        return;
      }
      const { data, error } = await supabase
        .from('documents')
        .select('*')
        .eq('user_id', uid)
        .order('uploaded_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      setPreviousUploads((data || []).map(mapDocumentRow));
    } catch (docError) {
      console.warn('Failed to load document metadata:', docError);
      setPreviousUploads([]);
    } finally {
      setPreviousUploadsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPersistedDocuments();
  }, [loadPersistedDocuments]);

  const toggleDocDetails = (docId) => {
    setExpandedDocId(prev => (prev === docId ? null : docId));
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getFileIcon = (type) => {
    if (type.includes('pdf')) return '📄';
    if (type.includes('image')) return '🖼️';
    return '📎';
  };

  return (
    <main>
      <section className="hero">
        <h1 className="hero-title">My Uploaded Documents</h1>
        <p className="hero-subtitle">View all your uploaded medical documents and their extraction status.</p>
        <div className="hero-cta">
          <button className="btn btn-light" onClick={() => navigate('/patient')}>Back to Patient Overview</button>
          <button className="btn btn-primary" onClick={() => navigate('/patient/uploads')}>Upload New Document</button>
        </div>
      </section>

      <div className="uploaded-files">
        <h3>All Uploaded Documents</h3>
        {previousUploadsLoading ? (
          <div className="files-grid" style={{ marginTop: 8 }}>
            {Array.from({ length: 6 }).map((_,i) => (
              <div key={i} className="file-card" style={{ padding:'12px' }}>
                <div className="skeleton animate" style={{ height:18, width:'65%', marginBottom:10, borderRadius:'0.5rem' }} />
                <div className="skeleton animate" style={{ height:12, width:'50%', marginBottom:6, borderRadius:'0.5rem' }} />
                <div className="skeleton animate" style={{ height:12, width:'40%', borderRadius:'0.5rem' }} />
              </div>
            ))}
          </div>
        ) : previousUploads.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 8 }}>
            <p>No uploaded documents found yet.</p>
            <button className="btn btn-primary" onClick={() => navigate('/patient/uploads')}>Upload Your First Document</button>
          </div>
        ) : (
          <div className="files-grid">
            {previousUploads.map((doc) => (
              <div key={doc.id || doc.path} className="file-card">
                <div className="file-header">
                  <div className="file-icon">
                    {doc.type?.includes('pdf') ? '📄' : doc.type?.includes('image') ? '🖼️' : '📎'}
                  </div>
                  <div className="file-info">
                    <div className="file-name" title={doc.name}>{doc.name}</div>
                    <div className="file-meta">
                      {doc.size ? `${(doc.size/1024/1024).toFixed(2)} MB` : ''}
                      {doc.lastModified ? ` • ${new Date(doc.lastModified).toLocaleString()}` : ''}
                      {doc.status ? ` • ${doc.status}` : ''}
                    </div>
                    {doc.summary && (
                      <div className="muted" style={{ marginTop: 4 }}>{doc.summary}</div>
                    )}
                  </div>
                  {doc.url && (
                    <a className="btn btn-outline btn-sm" href={doc.url} target="_blank" rel="noreferrer">Open</a>
                  )}
                </div>
                {doc.extractedText && (
                  <div className="extracted-text" style={{ marginTop: 12 }}>
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <span className="muted text-sm">AI extracted text ({doc.extractedText.length.toLocaleString()} chars)</span>
                      <button
                        type="button"
                        className="btn btn-light btn-sm"
                        onClick={() => toggleDocDetails(doc.id || doc.path)}
                      >
                        {expandedDocId === (doc.id || doc.path) ? 'Hide text' : 'Show text'}
                      </button>
                    </div>
                    {expandedDocId === (doc.id || doc.path) ? (
                      <pre
                        className="extracted-text-block"
                        style={{
                          marginTop: 8,
                          background: 'var(--card-bg, rgba(148,163,184,0.08))',
                          padding: '12px',
                          borderRadius: '12px',
                          maxHeight: 240,
                          overflowY: 'auto',
                          whiteSpace: 'pre-wrap',
                          fontFamily: 'var(--font-mono, "SFMono-Regular", Consolas, monospace)'
                        }}
                      >
                        {doc.extractedText}
                      </pre>
                    ) : (
                      <p className="muted" style={{ marginTop: 8 }}>
                        {doc.extractedText.slice(0, 200)}
                        {doc.extractedText.length > 200 ? '…' : ''}
                      </p>
                    )}
                  </div>
                )}
                {!doc.extractedText && doc.status && doc.status !== 'complete' && (
                  <p className="muted" style={{ marginTop: 12 }}>Extraction still {doc.status}. Check back shortly.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
};

export default UploadedDocumentsPage;