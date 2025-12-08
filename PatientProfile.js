import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const PatientProfile = ({ user, onUpdateProfile }) => {
  const [patientData, setPatientData] = useState({
    patientId: '',
    name: '',
    gender: '',
    age: '',
    dateOfBirth: '',
    phone: '',
    address: '',
    emergencyContact: '',
    medicalHistory: '',
    allergies: '',
    medications: ''
  });
  
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [patientRow, setPatientRow] = useState(null);
  const [profileRow, setProfileRow] = useState(null);
  
  const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
  const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const derivePatientName = () => {
    if (patientData.name) return patientData.name;
    if (user?.user_metadata?.full_name) return user.user_metadata.full_name;
    if (user?.email) return user.email.split('@')[0];
    return '';
  };

  // Generate auto patient ID
  const generatePatientId = () => {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 5);
    return `PT${timestamp}${random}`.toUpperCase();
  };

  // Calculate age from date of birth
  const calculateAge = (birthDate) => {
    if (!birthDate) return '';
    const today = new Date();
    const birth = new Date(birthDate);
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    
    return age.toString();
  };

  const buildComponentState = (patientRecord, profileRecord) => {
    const canonicalName = patientRecord?.full_name || patientRecord?.name || profileRecord?.name || derivePatientName();
    const dob = patientRecord?.date_of_birth || profileRecord?.date_of_birth || '';
    const gender = profileRecord?.gender || patientRecord?.gender || '';
    const phone = patientRecord?.phone || profileRecord?.phone || '';
    const address = profileRecord?.address || patientRecord?.address || '';
    const patientId = profileRecord?.patient_id || patientRecord?.id || patientData.patientId;

    return {
      patientId: patientId || '',
      name: canonicalName || '',
      gender,
      age: calculateAge(dob),
      dateOfBirth: dob || '',
      phone,
      address,
      emergencyContact: profileRecord?.emergency_contact || '',
      medicalHistory: profileRecord?.medical_history || '',
      allergies: profileRecord?.allergies || '',
      medications: profileRecord?.medications || ''
    };
  };

  // Load patient data from Supabase
  useEffect(() => {
    const loadPatientData = async () => {
      if (!user) {
        setLoading(false);
        return;
      }

      try {
        const { data: patientData, error: patientErr } = await supabase
          .from('patients')
          .select('id,user_id,full_name,name,email,phone,address,date_of_birth,gender,created_at,updated_at')
          .eq('user_id', user.id)
          .maybeSingle();

        if (patientErr && patientErr.code !== 'PGRST116') throw patientErr;

        let resolvedPatient = patientData || null;
        if (!resolvedPatient) {
          const fallbackName = user.user_metadata?.full_name || user.email?.split('@')[0] || '';
          const basePayload = {
            user_id: user.id,
            full_name: fallbackName,
            name: fallbackName,
            email: user.email
          };
          const { data: insertedPatient, error: insertError } = await supabase
            .from('patients')
            .upsert(basePayload, { onConflict: 'user_id' })
            .select()
            .single();
          if (insertError) throw insertError;
          resolvedPatient = insertedPatient;
        }

        setPatientRow(resolvedPatient);
        setProfileRow(null);
        setPatientData(prev => ({
          ...prev,
          ...buildComponentState(resolvedPatient, null)
        }));
      } catch (err) {
        console.error('Error loading patient data:', err);
        setError('Failed to load patient profile');
      } finally {
        setLoading(false);
      }
    };

    loadPatientData();
  }, [user, supabase]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    let updatedData = { ...patientData, [name]: value };
    
    // Auto-calculate age when date of birth changes
    if (name === 'dateOfBirth') {
      updatedData.age = calculateAge(value);
    }
    
    setPatientData(updatedData);
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    
    try {
      const canonicalName = (patientData.name || '').trim() || derivePatientName();
      const patientPayload = {
        user_id: user.id,
        full_name: canonicalName,
        name: canonicalName,
        email: user.email,
        phone: patientData.phone || null,
        address: patientData.address || null,
        date_of_birth: patientData.dateOfBirth || null,
        gender: patientData.gender || null,
        updated_at: new Date().toISOString()
      };

      const { data: savedPatient, error: patientError } = await supabase
        .from('patients')
        .upsert(patientPayload, { onConflict: 'user_id' })
        .select()
        .single();

      if (patientError) throw patientError;

      // We no longer write to legacy `patient_profiles` here. If you need
      // extended fields (medical history, allergies, medications), create
      // a dedicated table or ensure the schema exists. For now store core
      // fields in `patients` and keep UI state in memory.

      setPatientRow(savedPatient);
      setProfileRow(null);
      setPatientData(prev => ({
        ...prev,
        ...buildComponentState(savedPatient, null)
      }));
      setEditing(false);
      if (onUpdateProfile) {
        onUpdateProfile({ ...patientData, ...buildComponentState(savedPatient, savedProfile) });
      }
    } catch (err) {
      console.error('Error saving patient data:', err);
      setError('Failed to save patient profile');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setPatientData(prev => ({
      ...prev,
      ...buildComponentState(patientRow, profileRow)
    }));
  };

  if (loading) {
    return (
      <div className="patient-profile loading">
        <div className="loading-spinner">Loading profile...</div>
      </div>
    );
  }

  return (
    <div className="patient-profile">
      <div className="profile-header">
        <h3>Patient Profile</h3>
        {!editing && (
          <button 
            className="btn-edit" 
            onClick={() => setEditing(true)}
          >
            ✏️ Edit Profile
          </button>
        )}
      </div>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      <div className="profile-content">
        <div className="profile-section">
          <h4>Basic Information</h4>
          <div className="profile-grid">
            <div className="profile-field">
              <label>Patient ID</label>
              {editing ? (
                <input
                  type="text"
                  name="patientId"
                  value={patientData.patientId}
                  onChange={handleInputChange}
                  readOnly
                  className="readonly-field"
                />
              ) : (
                <div className="field-value patient-id">{patientData.patientId}</div>
              )}
              <small className="field-help">Auto-generated ID</small>
            </div>

            <div className="profile-field">
              <label>Full Name *</label>
              {editing ? (
                <input
                  type="text"
                  name="name"
                  value={patientData.name}
                  onChange={handleInputChange}
                  required
                  placeholder="Enter your full name"
                />
              ) : (
                <div className="field-value">{patientData.name || 'Not provided'}</div>
              )}
            </div>

            <div className="profile-field">
              <label>Gender</label>
              {editing ? (
                <select
                  name="gender"
                  value={patientData.gender}
                  onChange={handleInputChange}
                >
                  <option value="">Select Gender</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                  <option value="prefer_not_to_say">Prefer not to say</option>
                </select>
              ) : (
                <div className="field-value">
                  {patientData.gender ? patientData.gender.charAt(0).toUpperCase() + patientData.gender.slice(1).replace('_', ' ') : 'Not provided'}
                </div>
              )}
            </div>

            <div className="profile-field">
              <label>Date of Birth</label>
              {editing ? (
                <input
                  type="date"
                  name="dateOfBirth"
                  value={patientData.dateOfBirth}
                  onChange={handleInputChange}
                  max={new Date().toISOString().split('T')[0]}
                />
              ) : (
                <div className="field-value">
                  {patientData.dateOfBirth ? new Date(patientData.dateOfBirth).toLocaleDateString() : 'Not provided'}
                </div>
              )}
            </div>

            <div className="profile-field">
              <label>Age</label>
              {editing ? (
                <input
                  type="number"
                  name="age"
                  value={patientData.age}
                  onChange={handleInputChange}
                  readOnly
                  className="readonly-field"
                />
              ) : (
                <div className="field-value">{patientData.age || 'Not calculated'}</div>
              )}
              <small className="field-help">Auto-calculated from date of birth</small>
            </div>

            <div className="profile-field">
              <label>Phone Number</label>
              {editing ? (
                <input
                  type="tel"
                  name="phone"
                  value={patientData.phone}
                  onChange={handleInputChange}
                  placeholder="(555) 123-4567"
                />
              ) : (
                <div className="field-value">{patientData.phone || 'Not provided'}</div>
              )}
            </div>
          </div>
        </div>

        <div className="profile-section">
          <h4>Contact Information</h4>
          <div className="profile-grid">
            <div className="profile-field full-width">
              <label>Address</label>
              {editing ? (
                <textarea
                  name="address"
                  value={patientData.address}
                  onChange={handleInputChange}
                  placeholder="Enter your full address"
                  rows="3"
                />
              ) : (
                <div className="field-value">{patientData.address || 'Not provided'}</div>
              )}
            </div>

            <div className="profile-field full-width">
              <label>Emergency Contact</label>
              {editing ? (
                <input
                  type="text"
                  name="emergencyContact"
                  value={patientData.emergencyContact}
                  onChange={handleInputChange}
                  placeholder="Name and phone number of emergency contact"
                />
              ) : (
                <div className="field-value">{patientData.emergencyContact || 'Not provided'}</div>
              )}
            </div>
          </div>
        </div>

        <div className="profile-section">
          <h4>Medical Information</h4>
          <div className="profile-grid">
            <div className="profile-field full-width">
              <label>Medical History</label>
              {editing ? (
                <textarea
                  name="medicalHistory"
                  value={patientData.medicalHistory}
                  onChange={handleInputChange}
                  placeholder="List any chronic conditions, surgeries, or major illnesses"
                  rows="4"
                />
              ) : (
                <div className="field-value">{patientData.medicalHistory || 'No medical history provided'}</div>
              )}
            </div>

            <div className="profile-field full-width">
              <label>Allergies</label>
              {editing ? (
                <textarea
                  name="allergies"
                  value={patientData.allergies}
                  onChange={handleInputChange}
                  placeholder="List any known allergies (medications, food, etc.)"
                  rows="3"
                />
              ) : (
                <div className="field-value">{patientData.allergies || 'No allergies reported'}</div>
              )}
            </div>

            <div className="profile-field full-width">
              <label>Current Medications</label>
              {editing ? (
                <textarea
                  name="medications"
                  value={patientData.medications}
                  onChange={handleInputChange}
                  placeholder="List current medications and dosages"
                  rows="3"
                />
              ) : (
                <div className="field-value">{patientData.medications || 'No medications reported'}</div>
              )}
            </div>
          </div>
        </div>

        {editing && (
          <div className="profile-actions">
            <button 
              className="btn-cancel" 
              onClick={handleCancel}
              disabled={saving}
            >
              Cancel
            </button>
            <button 
              className="btn-save" 
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Profile'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PatientProfile;
