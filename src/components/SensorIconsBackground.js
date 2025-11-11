import React, { useState, useEffect, useRef } from 'react';

// Utility functions for sensor management
const SensorUtils = {
  // Initialize Supabase client
  getSupabaseClient() {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
      const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
      
      if (supabaseUrl && supabaseKey) {
        return createClient(supabaseUrl, supabaseKey);
      }
    } catch (e) {
      console.warn('Supabase not available for sensor data');
    }
    return null;
  },

  // Generate sensor positions with better distribution
  generatePositions(count) {
    const positions = [];
    const margin = 5; // 5% margin from edges
    
    for (let i = 0; i < count; i++) {
      positions.push({
        left: `${margin + Math.random() * (100 - 2 * margin)}%`,
        top: `${margin + Math.random() * (100 - 2 * margin)}%`,
        delay: `${Math.random() * 4}s`,
        duration: `${3 + Math.random() * 4}s`
      });
    }
    
    return positions;
  },

  // Fetch sensor data from Supabase
  async fetchSensorData() {
    const supabase = this.getSupabaseClient();
    if (!supabase) return this.getFallbackSensorData();

    try {
      // Try to fetch from sensor_readings table
      const { data, error } = await supabase
        .from('sensor_readings')
        .select('sensor_type, reading_value, unit, timestamp')
        .order('timestamp', { ascending: false })
        .limit(50);

      if (error) {
        console.warn('Sensor data fetch error:', error);
        return this.getFallbackSensorData();
      }

      return this.transformSensorData(data || []);
    } catch (e) {
      console.warn('Failed to fetch sensor data:', e);
      return this.getFallbackSensorData();
    }
  },

  // Transform raw sensor data to display format
  transformSensorData(rawData) {
    return rawData.map(reading => ({
      type: reading.sensor_type,
      value: reading.reading_value,
      unit: reading.unit,
      timestamp: reading.timestamp,
      icon: this.getIconForSensorType(reading.sensor_type)
    }));
  },

  // Get appropriate icon for sensor type
  getIconForSensorType(sensorType) {
    const iconMap = {
      'heart_rate': '❤️',
      'temperature': '🌡️',
      'oxygen': '🫁',
      'glucose': '💉',
      'ecg': '📊',
      'respiratory': '🫁',
      'weight': '⚖️',
      'height': '📏',
      'bmi': '📊',
      'cholesterol': '🧪',
      'triglycerides': '🔬',
      'hba1c': '🩺',
      'creatinine': '💊',
      'sodium': '🧂',
      'potassium': '🥬',
      'calcium': '🥛',
      'magnesium': '💎',
      'phosphorus': '⚡',
      'uric_acid': '🧪',
      'vitamin_d': '☀️',
      'vitamin_b12': '🌾',
      'iron': '⚙️',
      'ferritin': '🔩',
      'hemoglobin': '🩸',
      'white_blood_cells': '🦠',
      'red_blood_cells': '🔴',
      'platelets': '🟫',
      'neutrophils': '🛡️',
      'lymphocytes': '🛡️',
      'monocytes': '🛡️',
      'eosinophils': '🛡️',
      'basophils': '🛡️',
      'crp': '🔥',
      'esr': '⏱️',
      'alt': '🔬',
      'ast': '🔬',
      'bilirubin': '🟡',
      'albumin': '🥚',
      'globulin': '🧬',
      'protein': '🥩',
      'ph': '🧪',
      'cortisol': '🧠',
      'testosterone': '💪',
      'estrogen': '♀️',
      'progesterone': '🤰',
      'tsh': '🦋',
      't3': '🔥',
      't4': '❄️',
      'insulin': '💉',
      'c_peptide': '🔗',
      'glucagon': '🍬',
      'amylase': '🌾',
      'lipase': '🧈',
      'ck': '💪',
      'ck_mb': '❤️',
      'troponin': '❤️',
      'bnp': '🫀',
      'nt_pro_bnp': '🫀',
      'd_dimer': '🩸',
      'fibrinogen': '🕸️',
      'inr': '⚖️',
      'pt': '⏱️',
      'ptt': '⏱️',
      'wbc': '🦠',
      'rbc': '🔴',
      'hgb': '🩸',
      'hct': '🩸',
      'mcv': '🔴',
      'mch': '🩸',
      'mchc': '🩸',
      'rdw': '📏',
      'plt': '🟫',
      'mpv': '🟫',
      'neut': '🛡️',
      'lymph': '🛡️',
      'mono': '🛡️',
      'eos': '🛡️',
      'baso': '🛡️'
    };
    
    return iconMap[sensorType] || '🩺';
  },

  // Get fallback sensor data when Supabase is not available
  getFallbackSensorData() {
    const sensorTypes = [
      'heart_rate', 'temperature', 'oxygen', 'glucose',
      'ecg', 'respiratory', 'weight', 'height', 'bmi', 'cholesterol',
      'triglycerides', 'hba1c', 'creatinine', 'sodium', 'potassium',
      'calcium', 'magnesium', 'phosphorus', 'uric_acid', 'vitamin_d',
      'vitamin_b12', 'iron', 'ferritin', 'hemoglobin', 'white_blood_cells',
      'red_blood_cells', 'platelets', 'crp', 'esr'
    ];

    return sensorTypes.map((type, index) => ({
      type,
      value: Math.random() * 100 + 50,
      unit: this.getUnitForSensorType(type),
      timestamp: new Date(Date.now() - index * 60000).toISOString(),
      icon: this.getIconForSensorType(type)
    }));
  },

  // Get unit for sensor type
  getUnitForSensorType(sensorType) {
    const unitMap = {
      'heart_rate': 'bpm',
      'temperature': '°F',
      'oxygen': '%',
      'glucose': 'mg/dL',
      'ecg': 'mV',
      'respiratory': 'bpm',
      'weight': 'kg',
      'height': 'cm',
      'bmi': 'kg/m²',
      'cholesterol': 'mg/dL',
      'triglycerides': 'mg/dL',
      'hba1c': '%',
      'creatinine': 'mg/dL',
      'sodium': 'mEq/L',
      'potassium': 'mEq/L',
      'calcium': 'mg/dL',
      'magnesium': 'mg/dL',
      'phosphorus': 'mg/dL',
      'uric_acid': 'mg/dL',
      'vitamin_d': 'ng/mL',
      'vitamin_b12': 'pg/mL',
      'iron': 'mcg/dL',
      'ferritin': 'ng/mL',
      'hemoglobin': 'g/dL',
      'white_blood_cells': 'K/µL',
      'red_blood_cells': 'M/µL',
      'platelets': 'K/µL',
      'crp': 'mg/L',
      'esr': 'mm/hr'
    };
    
    return unitMap[sensorType] || 'units';
  }
};

const SensorIconsBackground = ({ count = 48, opacity = 0.18 }) => {
  const [sensorData, setSensorData] = useState([]);
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef(null);
  const pointerRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const initializeSensorData = async () => {
      try {
        // Fetch sensor data from Supabase
        const data = await SensorUtils.fetchSensorData();
        setSensorData(data);
        
        // Generate positions for sensors
        const generatedPositions = SensorUtils.generatePositions(count);
        setPositions(generatedPositions);
      } catch (error) {
        console.error('Failed to initialize sensor data:', error);
      } finally {
        setLoading(false);
      }
    };

    initializeSensorData();
  }, [count]);

  // Parallax and pointer-driven subtle movement
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const container = containerRef.current;
    if (!container) return;

    let raf = null;
    let enabled = true;

    const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) enabled = false;

    const onMove = (e) => {
      pointerRef.current.x = (e.clientX / window.innerWidth) - 0.5;
      pointerRef.current.y = (e.clientY / window.innerHeight) - 0.5;
    };

    const onScroll = () => {
      // use RAF to update transform based on scroll offset
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const top = window.scrollY || window.pageYOffset;
        const height = window.innerHeight;
        const pct = Math.min(1, top / Math.max(1, height));
        // move container slightly for depth effect
        if (container) container.style.transform = `translateY(${pct * -12}px)`;
      });
    };

    const frame = () => {
      if (!enabled) return;
      const px = pointerRef.current.x;
      const py = pointerRef.current.y;
      // iterate children and apply small transforms
      const kids = container.querySelectorAll('.sensor-icon');
      kids.forEach((el, i) => {
        const depth = Number(el.getAttribute('data-depth')) || 0.5;
        const tx = px * (6 + depth * 18) * (i % 2 === 0 ? 1 : -1);
        const ty = py * (6 + depth * 12);
        el.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${1 + depth * 0.02})`;
      });
      raf = requestAnimationFrame(frame);
    };

    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    raf = requestAnimationFrame(frame);

    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [loading, positions]);

  if (loading) {
    return (
      <div className="sensor-bg sensor-bg--empty" aria-hidden="true" />
    );
  }

  return (
    <div ref={containerRef} className="sensor-bg" aria-hidden="false">
      <div className="sensor-bg__gradient" />
      {Array.from({ length: Math.min(count, Math.max(sensorData.length, positions.length)) }).map((_, index) => {
        const sensor = sensorData[index % sensorData.length];
        const pos = positions[index % positions.length];
        if (!sensor || !pos) return null;

        const depth = Math.min(1, Math.max(0.15, (index % 7) / 7));
        const sizeClass = index % 5 === 0 ? 'sensor-icon--lg' : index % 3 === 0 ? 'sensor-icon--sm' : 'sensor-icon--md';

        return (
          <div
            key={`${sensor.type}-${index}`}
            className={`sensor-icon ${sizeClass}`}
            data-depth={depth}
            style={{ left: pos.left, top: pos.top, opacity }}
            tabIndex={-1}
            role="img"
            aria-label={`${sensor.type} ${sensor.value} ${sensor.unit}`}
          >
            <span className="sensor-icon__glyph">{sensor.icon}</span>
            <div className="sensor-tooltip" aria-hidden="true">
              <div className="sensor-tooltip__title">{sensor.type.replace(/_/g, ' ')}</div>
              <div className="sensor-tooltip__value">{Number(sensor.value).toFixed(1)} {sensor.unit}</div>
              <div className="sensor-tooltip__time muted">{new Date(sensor.timestamp).toLocaleTimeString()}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default SensorIconsBackground;
