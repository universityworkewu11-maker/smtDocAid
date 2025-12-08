import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import supabase from '../lib/supabaseClient';

// Supabase client imported from centralized module

const DoctorDirectoryPage = () => {
	const navigate = useNavigate();
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [doctors, setDoctors] = useState([]);
	const [q, setQ] = useState('');
	const [filters, setFilters] = useState({ specialty: '', location: '' });

	useEffect(() => {
		(async () => {
			setLoading(true);
			setError('');
			try {
				// Prefer the `doctors` table if present; fall back to `doctor_profiles` for backward compatibility
				let data = [];
				let err = null;
				try {
					const res = await supabase
						.from('doctors')
						.select('id, user_id, name, email, specialty, bio, license_number, age, updated_at')
						.order('updated_at', { ascending: false })
						.limit(100);
					if (res.error) throw res.error;
					data = res.data || [];
				} catch (e) {
					err = e;
				}

				if (!data || data.length === 0) {
					const res2 = await supabase
						.from('doctor_profiles')
						.select('id, user_id, full_name, email, specialty, location, city, bio, updated_at')
						.order('updated_at', { ascending: false })
						.limit(100);
					if (res2.error && !data?.length) throw (err || res2.error);
					data = res2.data || data || [];
				}

				setDoctors(data);
			} catch (e) {
				setError(e?.message || String(e));
			} finally {
				setLoading(false);
			}
		})();
	}, []);

	const filtered = useMemo(() => {
		const term = q.trim().toLowerCase();
		return (doctors || []).filter(d => {
			const name = String(d.name || d.full_name || '').toLowerCase();
			const email = String(d.email || '').toLowerCase();
			const spec = String(d.specialist || d.specialty || d.specialities || '').toLowerCase();
			const loc = String(d.location || d.city || '').toLowerCase();
			const matchesQ = !term || name.includes(term) || email.includes(term) || spec.includes(term) || loc.includes(term);
			const matchSpec = !filters.specialty || spec.includes(filters.specialty.toLowerCase());
			const matchLoc = !filters.location || loc.includes(filters.location.toLowerCase());
			return matchesQ && matchSpec && matchLoc;
		});
	}, [q, filters, doctors]);

	return (
		<main>
			<section className="hero animate-fade-up">
				<h1 className="hero-title">Find a Doctor</h1>
				<p className="hero-subtitle">Browse verified doctors and view public profiles to coordinate care.</p>
				<div className="hero-cta">
					<button className="btn btn-light" onClick={() => navigate(-1)}>Back</button>
				</div>
				<div className="hero-parallax-layer" aria-hidden="true">
					<div className="blob indigo"></div>
					<div className="blob cyan"></div>
				</div>
			</section>

			<div className="card">
				<div className="profile-header" style={{ gap: 12, flexWrap: 'wrap' }}>
					<h2 className="card-title">Directory</h2>
					<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
						<input
							className="form-input"
							placeholder="Search name, specialty, or location"
							value={q}
							onChange={(e) => setQ(e.target.value)}
							style={{ minWidth: 260 }}
						/>
						<input
							className="form-input"
							placeholder="Filter by specialty"
							value={filters.specialty}
							onChange={(e) => setFilters(prev => ({ ...prev, specialty: e.target.value }))}
						/>
						<input
							className="form-input"
							placeholder="Filter by location"
							value={filters.location}
							onChange={(e) => setFilters(prev => ({ ...prev, location: e.target.value }))}
						/>
					</div>
				</div>

				{error && <div className="alert alert-danger">{error}</div>}
						{loading ? (
							<div className="muted" style={{ display:'grid', gap:12 }}>
								<div className="skeleton animate" style={{ height: 44, width: '40%' }} />
								<div className="feature-grid">
									{Array.from({ length: 6 }).map((_, i) => (
										<div key={i} className="feature-card scroll-float">
											<div className="skeleton animate" style={{ height: 18, width: '60%', marginBottom: 10 }} />
											<div className="skeleton animate" style={{ height: 12, width: '80%', marginBottom: 8 }} />
											<div className="skeleton animate" style={{ height: 12, width: '70%', marginBottom: 16 }} />
											<div style={{ display:'flex', gap:8 }}>
												<div className="skeleton animate" style={{ height: 36, width: 120 }} />
												<div className="skeleton animate" style={{ height: 36, width: 100 }} />
											</div>
										</div>
									))}
								</div>
							</div>
				) : (
					  <div className="feature-grid stagger">
						{filtered.length === 0 ? (
							<div className="muted">No doctors match your search.</div>
						) : (
											filtered.map((d) => (
												<div key={d.id || d.user_id} className="feature-card tilt reveal scroll-float">
									<div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
														<div className="badge">{(d.specialist || d.specialty || d.specialities || 'General').slice(0, 24)}</div>
									</div>
													<h3 style={{ marginBottom: 6 }}>{d.name || d.full_name || 'Doctor'}</h3>
													<p className="muted" style={{ marginBottom: 8 }}>{d.location || d.city || ''}</p>
									{d.bio && <p className="" style={{ marginBottom: 12 }}>{d.bio}</p>}
									<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
										<button
											className="btn btn-primary"
															onClick={() => navigate(`/patient/doctors/${d.id || d.user_id}`)}
										>
											View Profile
										</button>
										{d.email && (
											<a className="btn btn-light" href={`mailto:${d.email}`}>Email</a>
										)}
									</div>
								</div>
							))
						)}
					</div>
				)}
			</div>
		</main>
	);
};

export default DoctorDirectoryPage;

