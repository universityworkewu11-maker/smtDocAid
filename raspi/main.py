import os
import requests
import time

# API endpoint for sensor readings (configurable via env)
SENSOR_BASE_URL = os.getenv("RPI_SENSOR_BASE_URL", "http://10.60.216.96:7000")

# Backend API endpoint to post vitals (configurable via env)
BACKEND_URL = os.getenv(
    "BACKEND_URL",
    "https://smt-doc-aid-backend-server-dlucoq5j7-amitubs-projects.vercel.app/api/vitals",
)

# HTTP timeout (seconds)
HTTP_TIMEOUT = float(os.getenv("HTTP_TIMEOUT", "5"))

def get_sensor_readings():
    readings = {}
    try:
        # Fetch temperature
        response = requests.get(
            f"{SENSOR_BASE_URL}/api/read/temperature?pin=4", timeout=HTTP_TIMEOUT
        )
        response.raise_for_status()
        readings['temperature'] = response.json().get('value')

        # Fetch heart rate
        response = requests.get(
            f"{SENSOR_BASE_URL}/api/read/heartRate?pin=17", timeout=HTTP_TIMEOUT
        )
        response.raise_for_status()
        readings['heartRate'] = response.json().get('value')

        # Fetch SpO2
        response = requests.get(
            f"{SENSOR_BASE_URL}/api/read/spo2?pin=27", timeout=HTTP_TIMEOUT
        )
        response.raise_for_status()
        readings['spo2'] = response.json().get('value')

        return readings
    except requests.exceptions.RequestException as e:
        print(f"Error fetching sensor readings: {e}")
        return None

def post_vitals_to_backend(temperature, heart_rate, spo2):
    try:
        payload = {
            "temperature": temperature,
            "heartRate": heart_rate,
            "spo2": spo2
        }
        response = requests.post(BACKEND_URL, json=payload, timeout=HTTP_TIMEOUT)
        response.raise_for_status()
        print("Vitals posted to backend successfully")
    except requests.exceptions.RequestException as e:
        print(f"Error posting vitals to backend: {e}")

def main():
    while True:
        readings = get_sensor_readings()
        if readings:
            print("Sensor Readings:")
            print(readings)
            temperature = readings.get('temperature')
            heart_rate = readings.get('heartRate')
            spo2 = readings.get('spo2')
            if temperature is not None or heart_rate is not None or spo2 is not None:
                post_vitals_to_backend(temperature, heart_rate, spo2)
        time.sleep(5)  # Poll every 5 seconds

if __name__ == "__main__":
    main()