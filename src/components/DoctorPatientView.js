import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import supabase from '../lib/supabaseClient';

// Supabase client imported from centralized module

const DoctorPatientView = () => {
	const navigate = useNavigate();
	const { id } = useParams();
		const [loading, setLoading] = useState(true);
		const [error, setError] = useState('');
		const [patient, setPatient] = useState(null);
		const [vitals, setVitals] = useState(null);
		const [reports, setReports] = useState([]);
		const [severityCounts, setSeverityCounts] = useState({ low: 0, medium: 0, high: 0 });
		const [latestSeverity, setLatestSeverity] = useState(null);
		const [filterDate, setFilterDate] = useState('');
		const [filterTimeStart, setFilterTimeStart] = useState('');
		const [filterTimeEnd, setFilterTimeEnd] = useState('');

	const verifyDoctorAccess = async (doctorAuthId, doctorRowId, patientIdentifier, patientRowId) => {
		const doctorIdOr = doctorRowId
			? `doctor_id.eq.${doctorAuthId},doctor_id.eq.${doctorRowId}`
			: `doctor_id.eq.${doctorAuthId}`;
		const patientIdOr = patientRowId && patientRowId !== patientIdentifier
			? `patient_id.eq.${patientIdentifier},patient_id.eq.${patientRowId}`
			: `patient_id.eq.${patientIdentifier}`;
		const { data, error } = await supabase
			.from('notifications')
			.select('id')
			.eq('type', 'report_shared')
			.or(doctorIdOr)
			.or(patientIdOr)
			.limit(1);
		if (error) throw error;
		if (Array.isArray(data) && data.length) return true;
		return false;
	};

	useEffect(() => {
		let mounted = true;
		(async () => {
			setLoading(true);
			setError('');
			try {
				const { data: { user } } = await supabase.auth.getUser();
				if (!user) throw new Error('Not authenticated');

				// Get doctor row id for legacy notifications (some rows used doctors.id)
				const { data: doctorRow } = await supabase
					.from('doctors')
					.select('id, user_id')
					.eq('user_id', user.id)
					.maybeSingle();
				const doctorRowId = doctorRow?.id || null;

				// Fetch patient row early so we can use both user_id and patients.id when matching notifications
				let p = await supabase
					.from('patients')
					.select('user_id, full_name, name, age, gender, phone, email, address, created_at, updated_at, id')
					.eq('user_id', id)
					.maybeSingle();
				if (p.data) {
					setPatient(p.data);
				} else if (p.error) {
					setError(p.error.message || 'Patient not found');
				}

				const allowed = await verifyDoctorAccess(user.id, doctorRowId, id, p.data?.id || null);
				if (!allowed) {
					if (mounted) {
						setError('Access denied. This patient has not shared their records with you yet.');
						setPatient(null);
						setVitals(null);
						setReports([]);
						setSeverityCounts({ low: 0, medium: 0, high: 0 });
						setLatestSeverity(null);
					}
					return;
				}
				if (!mounted) return;

				// Latest vitals from public.vitals
				try {
					const { data: vv } = await supabase
						.from('vitals')
						.select('*')
						.eq('user_id', p.data?.user_id || id)
						.order('created_at', { ascending: false })
						.limit(1);
					if (Array.isArray(vv) && vv.length) setVitals(vv[0]);
				} catch (_) {}

				// Only show reports that were explicitly shared with THIS doctor.
				const tbl = process.env.REACT_APP_TBL_REPORT || 'diagnoses';
				const patientIdOr = p.data?.id && p.data.id !== id
					? `patient_id.eq.${id},patient_id.eq.${p.data.id}`
					: `patient_id.eq.${id}`;
				const doctorIdOr = doctorRowId
					? `doctor_id.eq.${user.id},doctor_id.eq.${doctorRowId}`
					: `doctor_id.eq.${user.id}`;

				let sharedRows = [];
				try {
					const { data: nrows, error: nerr } = await supabase
						.from('notifications')
						.select('diagnosis_id, report_id, created_at')
						.eq('type', 'report_shared')
						.or(doctorIdOr)
						.or(patientIdOr)
						.order('created_at', { ascending: false })
						.limit(200);
					if (nerr) throw nerr;
					sharedRows = Array.isArray(nrows) ? nrows : [];
				} catch (e) {
					console.warn('Failed to fetch shared report pointers:', e?.message || e);
					sharedRows = [];
				}

				const sharedIds = Array.from(
					new Set(
						(sharedRows || [])
							.map((r) => r?.diagnosis_id || r?.report_id)
							.filter(Boolean)
					)
				);

				let list = [];
				if (sharedIds.length) {
					try {
						const { data: rr, error: rErr } = await supabase
							.from(tbl)
							.select('id,patient_id,content,severity,ai_generated,created_at,metadata')
							.in('id', sharedIds)
							.order('created_at', { ascending: false })
							.limit(50);
						if (rErr) throw rErr;
						list = rr || [];
					} catch (e) {
						console.warn('Failed to fetch shared diagnoses:', e?.message || e);
						list = [];
					}
				}

				setReports(list);
				const counts = { low: 0, medium: 0, high: 0 };
				for (const r of list) {
					const sev = (r.severity || 'low').toLowerCase();
					if (counts[sev] != null) counts[sev] += 1;
				}
				setSeverityCounts(counts);
				if (list.length) setLatestSeverity((list[0].severity || 'low').toLowerCase());
			} catch (e) {
				if (mounted) setError(e?.message || String(e));
			} finally {
				if (mounted) setLoading(false);
			}
		})();
		return () => { mounted = false; };
	}, [id]);

		return (
			<main>
				<section className="hero animate-fade-up">
					<h1 className="hero-title">Patient Overview</h1>
					<p className="hero-subtitle">Latest vitals and AI/clinical reports at a glance.</p>
					<div className="hero-cta">
						<button className="btn btn-light" onClick={() => navigate(-1)}>Back</button>
					</div>
					<div className="hero-parallax-layer" aria-hidden="true">
						<div className="blob indigo"></div>
						<div className="blob cyan"></div>
					</div>
				</section>

				<div className="card">
					{error && <div className="alert alert-danger">{error}</div>}
					{loading ? (
						<div className="feature-grid" style={{ marginTop: 12 }}>
							{Array.from({ length: 3 }).map((_, i) => (
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
							<div className="profile-header">
								<h2 className="card-title">{patient?.full_name || patient?.name || 'Patient'}</h2>
								{patient?.age != null && <span className="badge ml-2">Age: {patient.age}</span>}
								{patient?.gender && <span className="badge ml-2">{patient.gender}</span>}
								{patient?.user_id && <span className="badge">UID: {String(patient.user_id).slice(0,8)}</span>}
								{latestSeverity && (
									<span className={`badge ml-2 ${latestSeverity === 'high' ? 'badge-high' : latestSeverity === 'medium' ? 'badge-medium' : 'badge-low'}`}>Latest: {latestSeverity}</span>
								)}
							</div>

							<div className="feature-grid stagger">
								<div className="feature-card tilt reveal scroll-float">
									<h3>Vitals</h3>
									{vitals ? (
										<ul className="list-disc ml-4">
											<li>Temperature: {vitals.temperature ?? '—'} °F</li>
											<li>Heart Rate: {vitals.heart_rate ?? '—'} bpm</li>
											<li>SpO₂: {vitals.spo2 ?? '—'} %</li>
											{vitals.created_at && (
												<li className="muted">Recorded: {new Date(vitals.created_at).toLocaleString()}</li>
											)}
										</ul>
									) : (
										<p className="muted">No recent vitals.</p>
									)}
								</div>
								<div className="feature-card tilt reveal scroll-float">
									<h3>Demographics</h3>
									<p>Name: {patient?.full_name || patient?.name || '—'}</p>
									<p>Age: {patient?.age != null ? patient.age : '—'}</p>
									<p>Gender: {patient?.gender || '—'}</p>
								</div>
								<div className="feature-card tilt reveal scroll-float">
									<h3>Contact</h3>
									<p>Email: {patient?.email || '—'}</p>
									<p>Phone: {patient?.phone || '—'}</p>
									<p>Address: {patient?.address || '—'}</p>
								</div>
							</div>

							{/* Date/Time Filter UI */}
							<div className="card" style={{ marginTop: 16 }}>
								<h3 className="card-title">Filter Reports by Date/Time</h3>
								<div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
									<label>Date: <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} /></label>
									<label>Start Time: <input type="time" value={filterTimeStart} onChange={e => setFilterTimeStart(e.target.value)} /></label>
									<label>End Time: <input type="time" value={filterTimeEnd} onChange={e => setFilterTimeEnd(e.target.value)} /></label>
								</div>
							</div>

							<div className="card" style={{ marginTop: 16 }}>
								<h3 className="card-title">Recent Diagnoses / Reports</h3>
								{(severityCounts.low + severityCounts.medium + severityCounts.high) > 0 && (
									<div className="muted mb-2 text-xs">
										Severity counts: <span className="badge badge-low">low {severityCounts.low}</span> <span className="badge badge-medium ml-1">medium {severityCounts.medium}</span> <span className="badge badge-high ml-1">high {severityCounts.high}</span>
									</div>
								)}
								{/* Filter reports by date/time */}
								{reports.filter(r => {
									if (!filterDate) return true;
									const reportDate = new Date(r.created_at);
									const selectedDate = new Date(filterDate);
									if (reportDate.toDateString() !== selectedDate.toDateString()) return false;
									if (filterTimeStart) {
										const [h, m] = filterTimeStart.split(":");
										const start = new Date(selectedDate);
										start.setHours(Number(h), Number(m), 0, 0);
										if (reportDate < start) return false;
									}
									if (filterTimeEnd) {
										const [h, m] = filterTimeEnd.split(":");
										const end = new Date(selectedDate);
										end.setHours(Number(h), Number(m), 59, 999);
										if (reportDate > end) return false;
									}
									return true;
								}).length ? (
									<div className="card" style={{ maxHeight: 420, overflow: 'auto' }}>
										{reports.filter(r => {
											if (!filterDate) return true;
											const reportDate = new Date(r.created_at);
											const selectedDate = new Date(filterDate);
											if (reportDate.toDateString() !== selectedDate.toDateString()) return false;
											if (filterTimeStart) {
												const [h, m] = filterTimeStart.split(":");
												const start = new Date(selectedDate);
												start.setHours(Number(h), Number(m), 0, 0);
												if (reportDate < start) return false;
											}
											if (filterTimeEnd) {
												const [h, m] = filterTimeEnd.split(":");
												const end = new Date(selectedDate);
												end.setHours(Number(h), Number(m), 59, 999);
												if (reportDate > end) return false;
											}
											return true;
										}).map(r => (
											<div key={r.id} className="reveal" style={{ borderBottom: '1px solid var(--border)', padding: '12px 0' }}>
												<div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
													<div className="muted" style={{ marginBottom: 4 }}>{new Date(r.created_at || Date.now()).toLocaleString()}</div>
													<span className={`badge ${r.severity === 'high' ? 'badge-high' : r.severity === 'medium' ? 'badge-medium' : 'badge-low'}`}>{r.severity || 'low'}</span>
													{r.ai_generated && <span className="badge">AI</span>}
												</div>
												<pre className="report-content" style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{r.content}</pre>
												{/* Show latest vitals with each report */}
												{vitals && (
													<div className="muted" style={{ marginTop: 8 }}>
														<strong>Vitals:</strong> Temp: {vitals.temperature ?? '--'} °F, HR: {vitals.heart_rate ?? '--'} bpm, SpO₂: {vitals.spo2 ?? '--'} %
														{vitals.created_at && (
															<span style={{ marginLeft: 8 }}>({new Date(vitals.created_at).toLocaleString()})</span>
														)}
													</div>
												)}
											</div>
										))}
									</div>
								) : (
									<p className="muted">No reports yet.</p>
								)}
							</div>
						</>
					)}
				</div>
			</main>
	);
};

export default DoctorPatientView;

