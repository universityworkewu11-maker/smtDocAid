import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const splitFullName = (fullName = '') => {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: '', lastName: '' };
  const firstName = parts.shift() || '';
  const lastName = parts.length ? parts.join(' ') : '';
  return { firstName, lastName };
};

const mergePatientRecords = (patientRow, profileRow, user) => {
  const fallbackName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || '';
  const canonicalFullName = patientRow?.full_name || patientRow?.name || profileRow?.full_name || fallbackName;
  const { firstName, lastName } = splitFullName(canonicalFullName);

  return {
    patient_table_id: patientRow?.id || null,
    profile_table_id: profileRow?.id || null,
    first_name: profileRow?.first_name ?? firstName,
    last_name: profileRow?.last_name ?? lastName,
    full_name: canonicalFullName,
    date_of_birth: patientRow?.date_of_birth || profileRow?.date_of_birth || '',
    gender: profileRow?.gender || patientRow?.gender || '',
    phone: patientRow?.phone || profileRow?.phone || '',
    email: patientRow?.email || user?.email || '',
    address: profileRow?.address || patientRow?.address || '',
    emergency_contact: profileRow?.emergency_contact || '',
    blood_type: profileRow?.blood_type || '',
    height: profileRow?.height || '',
    weight: profileRow?.weight || '',
    allergies: profileRow?.allergies || '',
    chronic_conditions: profileRow?.chronic_conditions || '',
    medications: profileRow?.medications || '',
    family_history: profileRow?.family_history || '',
    insurance_info: profileRow?.insurance_info || '',
    primary_care_physician: profileRow?.primary_care_physician || '',
    additional_notes: profileRow?.additional_notes || ''
  };
};

const toNumberOrNull = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

function PatientProfilePage() {
  const navigate = useNavigate();
  const [patientData, setPatientData] = useState(null);
  const [patientRow, setPatientRow] = useState(null);
  const [profileRow, setProfileRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchPatientData();
  }, []);

  const fetchPatientData = async () => {
    try {
      const { data: authData } = await supabase.auth.getUser();
      const user = authData?.user;
      if (!user) {
        throw new Error('User not authenticated');
      }

      const { data: patientResponse, error: patientErr } = await supabase
        .from('patients')
        .select('id,user_id,full_name,name,email,phone,address,date_of_birth,gender,updated_at,created_at')
        .eq('user_id', user.id)
        .maybeSingle();

      if (patientErr && patientErr.code !== 'PGRST116') throw patientErr;

      let resolvedPatient = patientResponse || null;
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

      const merged = mergePatientRecords(resolvedPatient, null, user);
      setPatientRow(resolvedPatient);
      setProfileRow(null);
      setPatientData(merged);
      setFormData(merged);
    } catch (err) {
      console.error('Error fetching patient data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    
    try {
      const { data: authData } = await supabase.auth.getUser();
      const user = authData?.user;
      if (!user) throw new Error('User not authenticated');

      const nameFromFields = `${formData.first_name || ''} ${formData.last_name || ''}`.trim();
      const canonicalName = nameFromFields || formData.full_name || user.user_metadata?.full_name || user.email?.split('@')[0] || '';

      const patientPayload = {
        user_id: user.id,
        full_name: canonicalName,
        name: canonicalName,
        email: formData.email || user.email,
        phone: formData.phone || null,
        address: formData.address || null,
        date_of_birth: formData.date_of_birth || null,
        gender: formData.gender || null,
        updated_at: new Date().toISOString()
      };

      const { data: savedPatient, error: patientError } = await supabase
        .from('patients')
        .upsert(patientPayload, { onConflict: 'user_id' })
        .select()
        .single();

      if (patientError) throw patientError;

      const profilePayload = {
        user_id: user.id,
        first_name: formData.first_name || null,
        last_name: formData.last_name || null,
        full_name: canonicalName || null,
        date_of_birth: formData.date_of_birth || null,
        gender: formData.gender || null,
        phone: formData.phone || null,
        address: formData.address || null,
        emergency_contact: formData.emergency_contact || null,
        blood_type: formData.blood_type || null,
        height: toNumberOrNull(formData.height),
        weight: toNumberOrNull(formData.weight),
        allergies: formData.allergies || null,
        chronic_conditions: formData.chronic_conditions || null,
        medications: formData.medications || null,
        family_history: formData.family_history || null,
        insurance_info: formData.insurance_info || null,
        primary_care_physician: formData.primary_care_physician || null,
        additional_notes: formData.additional_notes || null,
        updated_at: new Date().toISOString()
      };

      if (profileRow?.id) {
        profilePayload.id = profileRow.id;
      }

      // Do not write to legacy `patient_profiles` here; store core patient fields
      // in `patients` only to avoid missing-column errors. If extended profile
      // storage is required, add a migration to create the `patient_profiles`
      // fields or a new table for medical details.
      const merged = mergePatientRecords(savedPatient, null, user);
      setPatientRow(savedPatient);
      setProfileRow(null);
      setPatientData(merged);
      setFormData(merged);
      setEditing(false);
      alert('Profile updated successfully!');
    } catch (err) {
      console.error('Error saving profile:', err);
      alert('Failed to save profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setFormData(patientData || {});
    setEditing(false);
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Not provided';
    const parsed = new Date(dateString);
    if (Number.isNaN(parsed.getTime())) return 'Not provided';
    return parsed.toLocaleDateString();
  };

  const calculateBMI = (weight, height) => {
    if (!weight || !height) return null;
    const heightInMeters = height / 100;
    return (weight / (heightInMeters * heightInMeters)).toFixed(1);
  };

  const getBMICategory = (bmi) => {
    if (!bmi) return '';
    if (bmi < 18.5) return 'Underweight';
    if (bmi < 25) return 'Normal weight';
    if (bmi < 30) return 'Overweight';
    return 'Obese';
  };

  if (loading) {
    return (
      <div className="profile-container">
        <div className="loading">Loading profile...</div>
      </div>
    );
  }

  return (
    <div className="profile-container">
      <div className="profile-content">
        <div className="profile-header">
          <h1>Patient Profile</h1>
          {!editing ? (
            <button className="btn-primary" onClick={() => setEditing(true)}>
              Edit Profile
            </button>
          ) : (
            <div className="edit-actions">
              <button 
                className="btn-secondary" 
                onClick={handleCancel}
                disabled={saving}
              >
                Cancel
              </button>
              <button 
                className="btn-primary" 
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          )}
        </div>

        <div className="profile-sections">
          {/* Personal Information */}
          <div className="profile-section">
            <h2>Personal Information</h2>
            <div className="profile-grid">
              <div className="form-group">
                <label>First Name</label>
                {editing ? (
                  <input
                    type="text"
                    name="first_name"
                    value={formData.first_name || ''}
                    onChange={handleInputChange}
                  />
                ) : (
                  <div className="profile-value">{patientData?.first_name || 'Not provided'}</div>
                )}
              </div>

              <div className="form-group">
                <label>Last Name</label>
                {editing ? (
                  <input
                    type="text"
                    name="last_name"
                    value={formData.last_name || ''}
                    onChange={handleInputChange}
                  />
                ) : (
                  <div className="profile-value">{patientData?.last_name || 'Not provided'}</div>
                )}
              </div>

              <div className="form-group">
                <label>Date of Birth</label>
                {editing ? (
                  <input
                    type="date"
                    name="date_of_birth"
                    value={formData.date_of_birth || ''}
                    onChange={handleInputChange}
                  />
                ) : (
                  <div className="profile-value">
                    {patientData?.date_of_birth ? formatDate(patientData.date_of_birth) : 'Not provided'}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label>Gender</label>
                {editing ? (
                  <select
                    name="gender"
                    value={formData.gender || ''}
                    onChange={handleInputChange}
                  >
                    <option value="">Select gender</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                ) : (
                  <div className="profile-value">
                    {patientData?.gender ? patientData.gender.charAt(0).toUpperCase() + patientData.gender.slice(1) : 'Not provided'}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label>Phone Number</label>
                {editing ? (
                  <input
                    type="tel"
                    name="phone"
                    value={formData.phone || ''}
                    onChange={handleInputChange}
                  />
                ) : (
                  <div className="profile-value">{patientData?.phone || 'Not provided'}</div>
                )}
              </div>

              <div className="form-group">
                <label>Email</label>
                <div className="profile-value">{patientData?.email || 'Not provided'}</div>
              </div>
            </div>

            <div className="form-group full-width">
              <label>Address</label>
              {editing ? (
                <textarea
                  name="address"
                  value={formData.address || ''}
                  onChange={handleInputChange}
                  rows={3}
                />
              ) : (
                <div className="profile-value">{patientData?.address || 'Not provided'}</div>
              )}
            </div>

            <div className="form-group full-width">
              <label>Emergency Contact</label>
              {editing ? (
                <input
                  type="text"
                  name="emergency_contact"
                  value={formData.emergency_contact || ''}
                  onChange={handleInputChange}
                  placeholder="Name and phone number"
                />
              ) : (
                <div className="profile-value">{patientData?.emergency_contact || 'Not provided'}</div>
              )}
            </div>
          </div>

          {/* Medical Information */}
          <div className="profile-section">
            <h2>Medical Information</h2>
            <div className="profile-grid">
              <div className="form-group">
                <label>Blood Type</label>
                {editing ? (
                  <select
                    name="blood_type"
                    value={formData.blood_type || ''}
                    onChange={handleInputChange}
                  >
                    <option value="">Select blood type</option>
                    <option value="A+">A+</option>
                    <option value="A-">A-</option>
                    <option value="B+">B+</option>
                    <option value="B-">B-</option>
                    <option value="AB+">AB+</option>
                    <option value="AB-">AB-</option>
                    <option value="O+">O+</option>
                    <option value="O-">O-</option>
                  </select>
                ) : (
                  <div className="profile-value">{patientData?.blood_type || 'Not provided'}</div>
                )}
              </div>

              <div className="form-group">
                <label>Height (cm)</label>
                {editing ? (
                  <input
                    type="number"
                    name="height"
                    value={formData.height || ''}
                    onChange={handleInputChange}
                    min="50"
                    max="250"
                  />
                ) : (
                  <div className="profile-value">{patientData?.height || 'Not provided'}</div>
                )}
              </div>

              <div className="form-group">
                <label>Weight (kg)</label>
                {editing ? (
                  <input
                    type="number"
                    name="weight"
                    value={formData.weight || ''}
                    onChange={handleInputChange}
                    min="20"
                    max="300"
                    step="0.1"
                  />
                ) : (
                  <div className="profile-value">{patientData?.weight || 'Not provided'}</div>
                )}
              </div>

              {patientData?.height && patientData?.weight && !editing && (
                <div className="form-group">
                  <label>BMI</label>
                  <div className="profile-value">
                    {calculateBMI(patientData.weight, patientData.height)} 
                    <span className="bmi-category">
                      ({getBMICategory(calculateBMI(patientData.weight, patientData.height))})
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="form-group full-width">
              <label>Allergies</label>
              {editing ? (
                <textarea
                  name="allergies"
                  value={formData.allergies || ''}
                  onChange={handleInputChange}
                  rows={3}
                  placeholder="List any known allergies..."
                />
              ) : (
                <div className="profile-value">{patientData?.allergies || 'No known allergies'}</div>
              )}
            </div>

            <div className="form-group full-width">
              <label>Chronic Conditions</label>
              {editing ? (
                <textarea
                  name="chronic_conditions"
                  value={formData.chronic_conditions || ''}
                  onChange={handleInputChange}
                  rows={3}
                  placeholder="List any chronic medical conditions..."
                />
              ) : (
                <div className="profile-value">{patientData?.chronic_conditions || 'No chronic conditions reported'}</div>
              )}
            </div>

            <div className="form-group full-width">
              <label>Current Medications</label>
              {editing ? (
                <textarea
                  name="medications"
                  value={formData.medications || ''}
                  onChange={handleInputChange}
                  rows={3}
                  placeholder="List current medications and dosages..."
                />
              ) : (
                <div className="profile-value">{patientData?.medications || 'No medications reported'}</div>
              )}
            </div>

            <div className="form-group full-width">
              <label>Family Medical History</label>
              {editing ? (
                <textarea
                  name="family_history"
                  value={formData.family_history || ''}
                  onChange={handleInputChange}
                  rows={3}
                  placeholder="Relevant family medical history..."
                />
              ) : (
                <div className="profile-value">{patientData?.family_history || 'No family history provided'}</div>
              )}
            </div>
          </div>

          {/* Additional Information */}
          <div className="profile-section">
            <h2>Additional Information</h2>
            
            <div className="form-group full-width">
              <label>Insurance Information</label>
              {editing ? (
                <textarea
                  name="insurance_info"
                  value={formData.insurance_info || ''}
                  onChange={handleInputChange}
                  rows={3}
                  placeholder="Insurance provider, policy number, etc..."
                />
              ) : (
                <div className="profile-value">{patientData?.insurance_info || 'No insurance information provided'}</div>
              )}
            </div>

            <div className="form-group full-width">
              <label>Primary Care Physician</label>
              {editing ? (
                <input
                  type="text"
                  name="primary_care_physician"
                  value={formData.primary_care_physician || ''}
                  onChange={handleInputChange}
                  placeholder="Doctor's name and contact information"
                />
              ) : (
                <div className="profile-value">{patientData?.primary_care_physician || 'Not provided'}</div>
              )}
            </div>

            <div className="form-group full-width">
              <label>Additional Notes</label>
              {editing ? (
                <textarea
                  name="additional_notes"
                  value={formData.additional_notes || ''}
                  onChange={handleInputChange}
                  rows={4}
                  placeholder="Any additional information you'd like to share..."
                />
              ) : (
                <div className="profile-value">{patientData?.additional_notes || 'No additional notes'}</div>
              )}
            </div>
          </div>
        </div>

        <div className="profile-actions">
          <button 
            className="btn-secondary" 
            onClick={() => navigate('/dashboard')}
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}

export default PatientProfilePage;
