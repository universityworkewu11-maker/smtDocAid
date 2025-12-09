import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import UploadDocumentsPage from './UploadDocumentsPage';

// Prepare mocks for the supabase client used by the component
const uploadMock = jest.fn().mockResolvedValue({ error: null });
const getPublicUrlMock = jest.fn(() => ({ data: { publicUrl: 'http://example.com/doc.pdf' } }));
const createSignedUrlMock = jest.fn().mockResolvedValue({ data: { signedUrl: 'http://example.com/doc.pdf' } });
const insertMock = jest.fn().mockResolvedValue({ data: { id: 'doc-1', storage_path: 'user-1/doc.pdf', original_name: 'doc.pdf', extraction_status: 'pending' }, error: null });
const getUserMock = jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } });

const mockStorageFrom = jest.fn(() => ({
  upload: uploadMock,
  getPublicUrl: getPublicUrlMock,
  createSignedUrl: createSignedUrlMock
}));

const mockFrom = jest.fn(() => ({
  insert: insertMock,
  select: jest.fn().mockReturnThis(),
  single: jest.fn().mockResolvedValue({ data: { id: 'doc-1', storage_path: 'user-1/doc.pdf', original_name: 'doc.pdf', extraction_status: 'pending' }, error: null })
}));

const mockSupabase = {
  auth: { getUser: getUserMock },
  storage: { from: mockStorageFrom },
  from: mockFrom
};

// Ensure the module returns both the default and named export shape
jest.mock('../lib/supabaseClient', () => ({ __esModule: true, default: mockSupabase, supabase: mockSupabase }));

describe('UploadDocumentsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('when a file is uploaded, a documents row is inserted with extraction_status pending', async () => {
    const file = new File(['dummy content'], 'test.pdf', { type: 'application/pdf' });

    const { container } = render(<UploadDocumentsPage />);

    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInTheDocument();

    // Simulate selecting a file
    fireEvent.change(input, { target: { files: [file] } });

    // Wait for storage upload to be called
    await waitFor(() => expect(mockStorageFrom).toHaveBeenCalled());
    // Ensure upload was attempted
    expect(uploadMock).toHaveBeenCalled();

    // Wait for documents insert to be called
    await waitFor(() => expect(mockFrom).toHaveBeenCalledWith('documents'));
    expect(insertMock).toHaveBeenCalled();

    // Inspect the payload inserted into the documents table
    const insertArg = insertMock.mock.calls[0][0][0];
    expect(insertArg).toHaveProperty('extraction_status', 'pending');
    expect(insertArg).toHaveProperty('storage_path');
    expect(insertArg).toHaveProperty('user_id', 'user-1');
  });
});
