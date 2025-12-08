import React, { useEffect, useState } from 'react';
import supabase from '../lib/supabaseClient';

// Supabase client imported from centralized module

const DoctorProfilePage = () => {
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState('');
	const [profile, setProfile] = useState({
		id: null,
		user_id: null,
		full_name: '',
		email: '',
		specialty: '',
		phone: '',
		location: '',
		bio: ''
	});

	useEffect(() => {
		(async () => {
			setLoading(true);
			setError('');
			try {
				const { data: { user } } = await supabase.auth.getUser();
				const uid = user?.id;
				if (!uid) throw new Error('Not signed in');
				const { data, error } = await supabase
					.from('doctor_profiles')
					.select('*')
					.eq('user_id', uid)
					.single();
				if (error && error.code !== 'PGRST116') throw error; // ignore row not found
				if (data) setProfile(prev => ({ ...prev, ...data }));
				else setProfile(prev => ({ ...prev, user_id: uid }));

				// Also attempt to read the newer `doctors` table and merge phone/name if present
				try {
					const { data: ddata, error: derr } = await supabase
						.from('doctors')
						.select('id, user_id, name, phone, specialty')
						.eq('user_id', uid)
						.maybeSingle();
					if (!derr && ddata) {
						setProfile(prev => ({
							...prev,
							id: prev.id || ddata.id,
							full_name: prev.full_name || ddata.name || prev.full_name,
							specialty: prev.specialty || ddata.specialty || prev.specialty,
							phone: prev.phone || ddata.phone || prev.phone
						}));
					}
				} catch (e) {
					// ignore doctors table read errors
				}
				// ensure email fallback from auth
				if (!data?.email) {
					setProfile(prev => ({ ...prev, email: user?.email || prev.email }));
				}
			} catch (e) {
				setError(e?.message || String(e));
			} finally {
				setLoading(false);
			}
		})();
	}, []);

	const handleChange = (k, v) => setProfile(prev => ({ ...prev, [k]: v }));

	const save = async () => {
		setSaving(true);
		setError('');
		try {
			// Upsert into legacy `doctor_profiles` table
			const payload = {
				user_id: profile.user_id,
				full_name: profile.full_name,
				email: profile.email,
				specialty: profile.specialty,
				location: profile.location,
				bio: profile.bio
			};
			let res = await supabase.from('doctor_profiles').upsert(payload).select().single();
			if (res.error) {
				// Fallback with minimal columns
				const minimal = { user_id: profile.user_id, full_name: profile.full_name, email: profile.email };
				res = await supabase.from('doctor_profiles').upsert(minimal).select().single();
				if (res.error) throw res.error;
			}
			setProfile(prev => ({ ...prev, ...(res.data || {}) }));

			// Also ensure `doctors` table is kept in sync (preferred for newer flows)
			try {
				const uid = profile.user_id;
				if (uid) {
					// Check if a doctors row exists for this user
					const { data: existing, error: existErr } = await supabase.from('doctors').select('id').eq('user_id', uid).maybeSingle();
					if (existErr) throw existErr;
					const docPayload = {
						user_id: uid,
						name: profile.full_name,
						specialty: profile.specialty,
						phone: profile.phone || null,
						email: profile.email || null
					};
					if (existing && existing.id) {
						await supabase.from('doctors').update(docPayload).eq('id', existing.id);
					} else {
						await supabase.from('doctors').insert(docPayload);
					}
				}
			} catch (docErr) {
				// If RLS or schema prevents writing to `doctors`, surface a non-blocking warning
				console.warn('Failed to sync profile to doctors table:', docErr?.message || docErr);
			}
		} catch (e) {
			setError(e?.message || String(e));
		} finally {
			setSaving(false);
		}
	};

	return (
		<main>
			<section className="hero animate-fade-up">
				<h1 className="hero-title">My Doctor Profile</h1>
				<p className="hero-subtitle">Keep your public information up to date so patients can find you.</p>
				<div className="hero-parallax-layer" aria-hidden="true">
					<div className="blob indigo"></div>
					<div className="blob cyan"></div>
				</div>
			</section>

			<div className="card form-container" style={{ maxWidth: 720 }}>
				<div className="profile-header">
					<h2 className="card-title">Public Profile</h2>
					<button className="btn btn-success" onClick={save} disabled={saving}>
						{saving ? 'Saving…' : 'Save Changes'}
					</button>
				</div>
				{error && <div className="alert alert-danger">{error}</div>}
				{loading ? (
					<div className="feature-grid" style={{ marginTop: 12 }}>
						{Array.from({ length: 2 }).map((_, i) => (
							<div key={i} className="feature-card tilt">
								<div className="skeleton animate" style={{ height: 20, width: '50%', marginBottom: 12 }} />
								<div className="skeleton animate" style={{ height: 12, width: '80%', marginBottom: 8 }} />
								<div className="skeleton animate" style={{ height: 12, width: '70%', marginBottom: 8 }} />
								<div className="skeleton animate" style={{ height: 12, width: '60%', marginBottom: 8 }} />
							</div>
						))}
					</div>
				) : (
					<>
						<div className="form-group">
							<label className="form-label">Full name</label>
							<input className="form-input" value={profile.full_name}
										 onChange={e => handleChange('full_name', e.target.value)} />
						</div>
						<div className="form-group">
							<label className="form-label">Email</label>
							<input className="form-input" type="email" value={profile.email}
										 onChange={e => handleChange('email', e.target.value)} />
						</div>
						<div className="form-group">
							<label className="form-label">Specialty</label>
							<input className="form-input" placeholder="e.g., Cardiology" value={profile.specialty || ''}
										 onChange={e => handleChange('specialty', e.target.value)} />
						</div>
						<div className="form-group">
							<label className="form-label">Location</label>
							<input className="form-input" placeholder="City, Country" value={profile.location || ''}
										 onChange={e => handleChange('location', e.target.value)} />
						</div>
						<div className="form-group">
							<label className="form-label">Bio</label>
							<textarea className="textarea-input" rows={4} value={profile.bio || ''}
												onChange={e => handleChange('bio', e.target.value)}
												placeholder="Short professional bio" />
						</div>
					</>
				)}
			</div>
		</main>
	);
};

export default DoctorProfilePage;

