import requests
import json

BASE_URL = "http://localhost:8000"

def test_registration():
    username = "testuser_debug"
    print(f"Testing registration for {username}...")
    
    # 1. Begin
    try:
        resp = requests.post(f"{BASE_URL}/auth/register/begin", json={"username": username})
        print(f"Begin Response ({resp.status_code}): {resp.text}")
        if resp.status_code != 200:
            return
    except Exception as e:
        print(f"Begin Request Failed: {e}")
        return

if __name__ == "__main__":
    test_registration()
