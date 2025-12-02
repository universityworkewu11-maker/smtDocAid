import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import supabase from '../lib/supabaseClient';

// Supabase client imported from centralized module
const MAX_UPLOAD_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_UPLOAD_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'application/pdf'
];

const mapDocumentRow = (row) => ({
  id: row?.id || row?.storage_path || row?.file_name,
  name: row?.original_name || row?.file_name || 'Document',
  path: row?.storage_path || row?.file_name || '',
  url: row?.public_url || null,
  size: row?.size_bytes || null,
  lastModified: row?.uploaded_at || row?.updated_at || null,
  type: row?.mime_type || 'application/octet-stream'
});

const UploadDocumentsPage = () => {
  const navigate = useNavigate();
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);
  const [previousUploads, setPreviousUploads] = useState([]);
  const [previousUploadsLoading, setPreviousUploadsLoading] = useState(true);

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
        .select('id, original_name, file_name, storage_path, public_url, mime_type, size_bytes, uploaded_at')
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

  // Upload files to Supabase (or mock)
  const uploadFiles = useCallback(async (files) => {
    if (!files?.length) return;
    setIsUploading(true);
    setError('');
    const newFiles = [];

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        setError('You must be signed in to upload documents.');
        return;
      }

      const bucket = process.env.REACT_APP_SUPABASE_BUCKET || 'uploads';

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const sanitizedOriginalName = file.name.replace(/\s+/g, '_');
        const fileName = `${fileId}-${sanitizedOriginalName}`;
        const storagePath = `${user.id}/${fileName}`;

        setUploadProgress(prev => ({ ...prev, [fileId]: 0 }));

        const { error: uploadError } = await supabase.storage
          .from(bucket)
          .upload(storagePath, file, {
            upsert: true,
            contentType: file.type || 'application/octet-stream'
          });

        if (uploadError) {
          console.error('Upload failed:', uploadError);
          setUploadProgress(prev => ({ ...prev, [fileId]: 'error' }));
          setError(uploadError.message || 'Failed to upload file.');
          continue;
        }

        let publicUrl = null;
        const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(storagePath);
        publicUrl = publicData?.publicUrl || null;

        if (!publicUrl) {
          try {
            const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(storagePath, 3600);
            publicUrl = signed?.signedUrl || null;
          } catch (signedError) {
            console.warn('Signed URL error:', signedError);
          }
        }

        try {
          const { data: insertedDocument, error: docError } = await supabase
            .from('documents')
            .insert([{
              user_id: user.id,
              storage_bucket: bucket,
              storage_path,
              file_name: fileName,
              original_name: file.name,
              mime_type: file.type,
              size_bytes: file.size,
              public_url: publicUrl,
              metadata: { source: 'UploadDocumentsPage' }
            }])
            .select('id, original_name, file_name, storage_path, public_url, mime_type, size_bytes, uploaded_at')
            .single();
          if (docError) throw docError;
          setPreviousUploads(prev => [mapDocumentRow(insertedDocument), ...prev]);
        } catch (docInsertError) {
          console.error('Failed to record document metadata:', docInsertError);
        }

        const uploadedFile = {
          id: fileId,
          name: file.name,
          fileName,
          storagePath,
          size: file.size,
          type: file.type,
          url: publicUrl,
          uploadedAt: new Date().toISOString(),
          status: 'completed'
        };

        newFiles.push(uploadedFile);
        setUploadProgress(prev => ({ ...prev, [fileId]: 100 }));
      }

      if (newFiles.length) {
        setUploadedFiles(prev => [...prev, ...newFiles]);
      }
    } finally {
      setIsUploading(false);
    }
  }, []);

  // Process selected files
  const handleFiles = useCallback(async (files) => {
    const validFiles = [];
    const errors = [];

    files.forEach(file => {
      // Validate file type
      if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) {
        errors.push(`${file.name}: Invalid file type. Please upload JPG, PNG, or PDF files.`);
        return;
      }

      // Validate file size
      if (file.size > MAX_UPLOAD_FILE_SIZE) {
        errors.push(`${file.name}: File too large. Maximum size is 10MB.`);
        return;
      }

      validFiles.push(file);
    });

    if (errors.length > 0) {
      setError(errors.join('\n'));
      return;
    }

    setError('');
    await uploadFiles(validFiles);
  }, [uploadFiles]);

  // Handle drag events
  const handleDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  // Handle file drop
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = [...e.dataTransfer.files];
    handleFiles(files);
  }, [handleFiles]);

  // Handle file selection
  const handleFileSelect = (e) => {
    const files = [...e.target.files];
    handleFiles(files);
  };

  // Remove uploaded file
  const removeFile = (fileId) => {
    setUploadedFiles(prev => prev.filter(file => file.id !== fileId));
    setUploadProgress(prev => {
      const newProgress = { ...prev };
      delete newProgress[fileId];
      return newProgress;
    });
  };

  // Format file size
  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Get file icon based on type
  const getFileIcon = (type) => {
    if (type.includes('pdf')) return '📄';
    if (type.includes('image')) return '🖼️';
    return '📎';
  };

  // Handle next step
  const handleNext = () => {
    if (uploadedFiles.length === 0) {
      setError('Please upload at least one document before proceeding.');
      return;
    }

    // Store uploaded files data
    localStorage.setItem('uploadedDocuments', JSON.stringify(uploadedFiles));
    navigate('/patient/questionnaire');
  };

  // Skip uploads and continue
  const handleSkip = () => {
    try { localStorage.setItem('uploadedDocuments', JSON.stringify(uploadedFiles || [])); } catch (_) {}
    navigate('/patient/questionnaire');
  };

  // Handle back navigation
  const handleBack = () => {
    navigate('/patient/vitals');
  };

  // Calculate total upload progress
  const totalProgress = uploadedFiles.length > 0 ?
    Object.values(uploadProgress).reduce((sum, progress) =>
      sum + (typeof progress === 'number' ? progress : 0), 0
    ) / uploadedFiles.length : 0;

  return (
    <main>
      {/* Hero header to align with new site aesthetic */}
  <section className="hero animate-fade-up">
        <h1 className="hero-title">Upload Medical Documents</h1>
        <p className="hero-subtitle">Add scans, lab results, and reports to enrich your AI assessment.</p>
        <div className="hero-cta">
          <button className="btn btn-light" onClick={() => navigate('/patient')}>Back to Patient Overview</button>
        </div>
  <div className="hero-stats stagger">
          <div className="hero-stat"><div className="text-xl font-semibold">Files</div><div className="text-3xl font-extrabold">{uploadedFiles.length}</div></div>
          <div className="hero-stat"><div className="text-xl font-semibold">Progress</div><div className="text-3xl font-extrabold">{Math.round(totalProgress)}%</div></div>
          <div className="hero-stat"><div className="text-xl font-semibold">Types</div><div className="text-3xl font-extrabold">JPG/PNG/PDF</div></div>
        </div>
        <div className="hero-parallax-layer" aria-hidden="true">
          <div className="blob indigo"></div>
          <div className="blob cyan"></div>
        </div>
      </section>

  <div className="card route-screen">
        <div className="upload-header">
          <h2 className="card-title">Drag & drop or browse</h2>
          <p className="upload-subtitle">
            Upload your medical history, lab results, or any relevant documents for AI analysis
          </p>
        </div>

        {/* Upload Area */}
        <div className="upload-container">
          <div
            className={`upload-zone ${dragActive ? 'drag-active' : ''} ${isUploading ? 'uploading' : ''} tilt reveal`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="upload-icon">
              {isUploading ? '⏳' : '📁'}
            </div>
            <div className="upload-text">
              <h3>
                {isUploading ? 'Uploading Files...' : 'Drag and drop files here'}
              </h3>
              <p>or click to browse files</p>
              <small>
                Supported formats: JPG, PNG, PDF (Max 10MB each)
              </small>
            </div>

            {isUploading && (
              <div className="upload-progress">
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${totalProgress}%` }}
                  />
                </div>
                <div className="progress-text">{Math.round(totalProgress)}%</div>
              </div>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".jpg,.jpeg,.png,.pdf"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
        </div>

        {/* Error Display */}
        {error && (
          <div className="alert alert-danger">
            {error.split('\n').map((errorLine, index) => (
              <div key={index}>{errorLine}</div>
            ))}
          </div>
        )}

        {/* Uploaded Files */}
        {uploadedFiles.length > 0 && (
          <div className="uploaded-files reveal">
            <h3>Uploaded Documents ({uploadedFiles.length})</h3>
            <div className="files-grid">
              {uploadedFiles.map((file) => (
                <div key={file.id} className="file-card">
                  <div className="file-header">
                    <div className="file-icon">{getFileIcon(file.type)}</div>
                    <div className="file-info">
                      <div className="file-name" title={file.name}>
                        {file.name}
                      </div>
                      <div className="file-meta">
                        {formatFileSize(file.size)} • {new Date(file.uploadedAt).toLocaleString()}
                      </div>
                    </div>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => removeFile(file.id)}
                      title="Remove file"
                    >
                      🗑️
                    </button>
                  </div>

                  {uploadProgress[file.id] !== undefined && (
                    <div className="file-progress">
                      <div className="progress-bar">
                        <div
                          className="progress-fill"
                          style={{ width: `${uploadProgress[file.id]}%` }}
                        />
                      </div>
                      <div className="progress-text">
                        {uploadProgress[file.id] === 'error' ? 'Error' : `${uploadProgress[file.id]}%`}
                      </div>
                    </div>
                  )}

                  {/* File Preview for Images */}
                  {file.type.includes('image') && (
                    <div className="file-preview">
                      <img
                        src={file.url}
                        alt={file.name}
                        onError={(e) => {
                          e.target.style.display = 'none';
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Previously Uploaded from Supabase */}
        <div className="uploaded-files reveal">
          <h3>Previously Uploaded (from your account)</h3>
          {previousUploads.length === 0 ? (
            <div className="files-grid" style={{ marginTop: 8 }}>
              {Array.from({ length: 4 }).map((_,i) => (
                <div key={i} className="file-card" style={{ padding:'12px' }}>
                  <div className="skeleton animate" style={{ height:18, width:'65%', marginBottom:10, borderRadius:'0.5rem' }} />
                  <div className="skeleton animate" style={{ height:12, width:'50%', marginBottom:6, borderRadius:'0.5rem' }} />
                  <div className="skeleton animate" style={{ height:12, width:'40%', borderRadius:'0.5rem' }} />
                </div>
              ))}
            </div>
          ) : (
            <div className="files-grid">
              {previousUploads.map((it) => (
                <div key={it.path} className="file-card">
                  <div className="file-header">
                    <div className="file-icon">{it.name.toLowerCase().endsWith('.pdf') ? '📄' : '🖼️'}</div>
                    <div className="file-info">
                      <div className="file-name" title={it.name}>{it.name}</div>
                      <div className="file-meta">
                        {(it.size ? `${(it.size/1024/1024).toFixed(2)} MB` : '')}
                        {it.lastModified ? ` • ${new Date(it.lastModified).toLocaleString()}` : ''}
                      </div>
                    </div>
                    {it.url && (
                      <a className="btn btn-outline btn-sm" href={it.url} target="_blank" rel="noreferrer">Open</a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="navigation-buttons">
          <button className="btn btn-secondary" onClick={handleBack}>
            ← Back to Vitals
          </button>

          <button
            className="btn btn-primary"
            onClick={handleNext}
            disabled={uploadedFiles.length === 0 || isUploading}
          >
            {isUploading ? 'Uploading...' : 'Generate AI Questionnaire →'}
          </button>

          <button
            className="btn btn-secondary"
            onClick={handleSkip}
            title="Skip document uploads for now and continue"
          >
            Skip for now →
          </button>
        </div>

        {/* Upload Tips */}
        <div className="upload-tips">
          <h4>💡 Tips for best results:</h4>
          <ul>
            <li>Upload clear, high-quality images of your documents</li>
            <li>Ensure text is readable and well-lit</li>
            <li>Include recent lab results, prescriptions, and medical reports</li>
            <li>Multiple documents are supported and recommended</li>
          </ul>
        </div>
      </div>
    </main>
  );
};

export default UploadDocumentsPage;