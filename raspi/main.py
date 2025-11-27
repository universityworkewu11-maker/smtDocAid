#!/usr/bin/env python3
"""
Simple Raspberry Pi sensor API simulator/adapter.

Endpoints:
- GET /api/health -> starts sampling loop (if not running) and returns status
- GET /api/read/<sensor>?pin=<pin>&wait=<seconds> -> returns latest cached value, optionally waits up to `wait` seconds for a non-null reading

This is intentionally simple so it can be replaced by hardware-specific code.
"""
from flask import Flask, jsonify, request
from flask_cors import CORS
import threading
import time
import os
import random

app = Flask(__name__)
CORS(app)

# Mode can be controlled with env var RASPI_MODE:
# - simulate  : produce noisy simulated values (default)
# - fixed     : return fixed values provided via env vars RASPI_FIXED_TEMPERATURE, RASPI_FIXED_HEARTRATE, RASPI_FIXED_SPO2
# - hardware  : placeholder mode where actual hardware reads should populate values (no random simulation)

# Shared state for latest readings
state_lock = threading.Lock()
latest = {
    'temperature': None,
    'heartRate': None,
    'spo2': None,
    'timestamp': None
}

sampling_thread = None
sampling_stop = threading.Event()


def sensor_loop():
    """Background sampling loop: populate `latest` periodically.
    Replace the simulated values with actual sensor reads on real Pi hardware.
    """
    mode = (os.environ.get('RASPI_MODE') or 'simulate').strip().lower()
    print(f'[raspi] sampling loop started (mode={mode})')
    while not sampling_stop.is_set():
        temp_val = None
        hr_val = None
        spo2_val = None

        if mode == 'simulate':
            # Simulate realistic sensor noise
            temp = 98.6 + (random.random() - 0.5) * 2.0
            hr = 72 + int((random.random() - 0.5) * 18)
            spo2 = 98 + int((random.random() - 0.5) * 3)

            # Always produce valid readings for testing
            hr_val = hr
            spo2_val = spo2
            temp_val = round(temp, 1)

        elif mode == 'fixed':
            # Use fixed values from env when present. If not set, keep None so callers see "no data".
            try:
                t = os.environ.get('RASPI_FIXED_TEMPERATURE')
                h = os.environ.get('RASPI_FIXED_HEARTRATE')
                s = os.environ.get('RASPI_FIXED_SPO2')
                temp_val = float(t) if t is not None else None
                hr_val = int(h) if h is not None else None
                spo2_val = int(s) if s is not None else None
            except Exception:
                temp_val = None
                hr_val = None
                spo2_val = None

        else:
            # hardware mode (default other): leave values as None and expect real hardware
            # Implement hardware reads here when deploying to a Pi with sensors.
            temp_val = None
            hr_val = None
            spo2_val = None

        with state_lock:
            latest['temperature'] = temp_val
            latest['heartRate'] = hr_val
            latest['spo2'] = spo2_val
            latest['timestamp'] = time.time()

        # sampling cadence
        time.sleep(1.0)

    print('[raspi] sampling loop stopped')


def ensure_sampling():
    global sampling_thread
    if sampling_thread and sampling_thread.is_alive():
        return True
    sampling_stop.clear()
    sampling_thread = threading.Thread(target=sensor_loop, daemon=True)
    sampling_thread.start()
    return True


@app.route('/api/health', methods=['GET'])
def health():
    ensure_sampling()
    with state_lock:
        ts = latest.get('timestamp')
    return jsonify({'ok': True, 'provider': 'raspi', 'sampling': True, 'timestamp': ts}), 200


@app.route('/api/read/<sensor>', methods=['GET'])
def read_sensor(sensor):
    sensor = sensor.strip()
    pin = request.args.get('pin', type=int)
    wait = request.args.get('wait', default=0, type=float)

    if sensor not in ('temperature', 'heartRate', 'spo2'):
        return jsonify({'ok': False, 'error': 'unknown sensor'}), 400

    ensure_sampling()

    deadline = time.time() + max(0.0, float(wait or 0))
    value = None
    ts = None
    # Poll until we have a non-null reading or timeout
    while True:
        with state_lock:
            value = latest.get(sensor)
            ts = latest.get('timestamp')
        if value is not None:
            break
        if time.time() >= deadline:
            break
        time.sleep(0.2)

    # Return in the expected format
    if sensor == 'heartRate':
        return jsonify({'heart_rate_bpm': value, 'valid': value is not None}), 200
    elif sensor == 'spo2':
        return jsonify({'spo2_percent': value, 'valid': value is not None}), 200
    elif sensor == 'temperature':
        return jsonify({'ambient_temp_C': value, 'connected': value is not None, 'object_temp_C': value}), 200


@app.route('/api/read', methods=['GET'])
def read_multi():
    # Convenience endpoint to return all latest values
    ensure_sampling()
    wait = request.args.get('wait', default=0, type=float)
    deadline = time.time() + max(0.0, float(wait or 0))
    # Wait until at least one non-null reading exists or timeout
    while True:
        with state_lock:
            if any(latest.get(k) is not None for k in ('temperature', 'heartRate', 'spo2')):
                break
            ts = latest.get('timestamp')
        if time.time() >= deadline:
            break
        time.sleep(0.2)

    with state_lock:
        out = {
            'temperature': latest.get('temperature'),
            'heartRate': latest.get('heartRate'),
            'spo2': latest.get('spo2'),
            'timestamp': latest.get('timestamp')
        }
    return jsonify({'ok': True, 'values': out}), 200


@app.route('/healthz', methods=['GET'])
def healthz():
    return jsonify({'status': 'ok'}), 200


@app.route('/api/max/once', methods=['GET'])
def max_once():
    ensure_sampling()
    # Wait a bit for readings
    time.sleep(1.0)
    with state_lock:
        hr = latest.get('heartRate')
        spo2 = latest.get('spo2')
    # Simulate quality metrics
    quality = {
        'algo_valid': hr is not None and spo2 is not None,
        'gate_ok': True,
        'hr_ema': hr,
        'hr_raw': hr if hr is not None else -999,
        'hr_recent': [hr] if hr is not None else [],
        'ir_ratio': 0.027993735624050352,
        'limits': [0.005, 3.0],
        'reason': 'algorithm_valid' if hr is not None and spo2 is not None else 'algorithm_invalid',
        'red_ratio': 0.031982853867433145,
        'spo2_raw': spo2 if spo2 is not None else -999.0,
        'stable': hr is not None and spo2 is not None,
        'tol': 10,
        'win_samples': 300
    }
    return jsonify({
        'heart_rate': hr,
        'heart_rate_avg': hr,
        'quality': quality,
        'spo2': spo2,
        'spo2_avg': spo2
    }), 200


if __name__ == '__main__':
    try:
        print('Starting Raspberry Pi API (simulator) on 0.0.0.0:7000')
        ensure_sampling()
        app.run(host='0.0.0.0', port=7000)
    except KeyboardInterrupt:
        sampling_stop.set()
        print('Shutting down')
