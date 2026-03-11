import requests
import json

BASE_URL = "http://localhost:8000"

def test_demo_login():
    username = "testuser1"
    print(f"Testing demo login for {username}...")
    
    try:
        resp = requests.post(f"{BASE_URL}/auth/demo/login", json={"username": username})
        print(f"Response ({resp.status_code}): {resp.text}")
    except Exception as e:
        print(f"Request Failed: {e}")

if __name__ == "__main__":
    test_demo_login()
