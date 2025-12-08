import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import supabase from '../lib/supabaseClient';

// Supabase client imported from centralized module

const DoctorPublicProfilePage = () => {
	const navigate = useNavigate();
	const { id } = useParams();
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [doc, setDoc] = useState(null);

	useEffect(() => {
		(async () => {
			setLoading(true);
			setError('');
			try {
				// Prefer `doctors` table if available, fallback to `doctor_profiles`
				let rec = null;
				let err = null;
				try {
					let q1 = await supabase.from('doctors').select('id, user_id, name, email, specialty, bio, license_number, age, created_at, updated_at').eq('id', id).single();
					if (q1.error) throw q1.error;
					rec = q1.data;
				} catch (e) {
					err = e;
				}
				if (!rec) {
					let q2 = await supabase.from('doctor_profiles').select('id, user_id, full_name, email, specialty, location, city, bio, created_at, updated_at').eq('id', id).single();
					if (q2.error) {
						q2 = await supabase.from('doctor_profiles').select('id, user_id, full_name, email, specialty, location, city, bio, created_at, updated_at').eq('user_id', id).single();
					}
					if (q2.error && !rec) throw (err || q2.error);
					rec = q2.data || rec;
				}
				setDoc(rec || null);
			} catch (e) {
				setError(e?.message || String(e));
			} finally {
				setLoading(false);
			}
		})();
	}, [id]);

	return (
		<main>
			<section className="hero animate-fade-up">
				<h1 className="hero-title">Doctor Profile</h1>
				<p className="hero-subtitle">Review credentials and contact details.</p>
				<div className="hero-cta">
					<button className="btn btn-light" onClick={() => navigate(-1)}>Back</button>
				</div>
				<div className="hero-parallax-layer" aria-hidden="true">
					<div className="blob indigo"></div>
					<div className="blob cyan"></div>
				</div>
			</section>

			<div className="card" style={{ maxWidth: 760, margin: '0 auto' }}>
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
				) : doc ? (
					<>
						<div className="profile-header" style={{ alignItems: 'flex-start' }}>
							<div>
								<h2 className="card-title" style={{ marginBottom: 6 }}>{doc.name || doc.full_name || 'Doctor'}</h2>
								<div className="badge" style={{ marginRight: 8 }}>{doc.specialty || doc.specialist || 'General'}</div>
								{(doc.location || doc.city) && <span className="muted" style={{ marginLeft: 8 }}>{doc.location || doc.city}</span>}
							</div>
							{doc.email && (
								<a className="btn btn-primary" href={`mailto:${doc.email}`}>Contact</a>
							)}
						</div>
						<div className="muted" style={{ display:'flex', gap:12, flexWrap:'wrap', marginTop:8 }}>
							{doc.license_number && <span>License: {doc.license_number}</span>}
							{Number.isFinite(doc.age) && <span>Age: {doc.age}</span>}
						</div>
						{doc.bio && (
							<div className="card" style={{ marginTop: 12 }}>
								<h3 className="card-title">About</h3>
								<p>{doc.bio}</p>
							</div>
						)}
					</>
				) : (
					<div className="muted">Doctor not found.</div>
				)}
			</div>
		</main>
	);
};

export default DoctorPublicProfilePage;

