#!/usr/bin/env python3
"""
Test script for the Raspberry Pi sensor API.
Runs the same curl commands as provided in the task.
"""
import requests
import time
import json

BASE_URL = 'http://127.0.0.1:7000'

def test_endpoint(url, description):
    try:
        print(f"\nTesting {description}: {url}")
        response = requests.get(url, timeout=10)
        print(f"Status: {response.status_code}")
        data = response.json()
        print(f"Response: {json.dumps(data, indent=2)}")
        return data
    except Exception as e:
        print(f"Error: {e}")
        return None

def main():
    print("Starting API tests...")

    # Test healthz
    test_endpoint(f"{BASE_URL}/healthz", "Health check")

    # Test heart rate
    test_endpoint(f"{BASE_URL}/api/read/heartRate?wait=3", "Heart Rate")

    # Test SpO2
    test_endpoint(f"{BASE_URL}/api/read/spo2?wait=5", "SpO2")

    # Test temperature
    test_endpoint(f"{BASE_URL}/api/read/temperature", "Temperature")

    # Test max/once
    test_endpoint(f"{BASE_URL}/api/max/once", "Max Once")

    print("\nAPI tests completed.")

if __name__ == '__main__':
    main()