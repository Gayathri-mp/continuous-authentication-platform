import os
import numpy as np
import uuid
from datetime import datetime, timedelta, timezone

# Add parent directory to path to import app modules
import sys
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.append(project_root)

from app.database import SessionLocal, init_db
from app.auth.models import User, UserBaseline, Session as SessionModel
from app.trust.ml_model import TrustModel
from app.trust.engine import _train_and_save_user_model, _load_model_from_db

def test_model_persistence():
    print("--- Starting Model Persistence Test ---")
    
    # 1. Setup
    print("Initializing database...")
    init_db()
    db = SessionLocal()
    
    test_user_id = str(uuid.uuid4())
    username = f"test_user_{test_user_id[:8]}"
    
    try:
        print(f"Creating test user: {username}")
        user = User(id=test_user_id, username=username)
        db.add(user)
        db.commit()
        
        # 2. Create dummy feature data
        print("Generating dummy training data...")
        # 30 samples, 12 features
        X_train = np.random.rand(30, 12)
        
        # 3. Train and save via engine
        print("Training and saving model via engine...")
        model = _train_and_save_user_model(db, test_user_id, X_train, sessions_used=3)
        
        if model is None:
            print("FAILURE: Model training failed")
            return

        # 4. Verify DB storage
        baseline = db.query(UserBaseline).filter(UserBaseline.user_id == test_user_id).first()
        if baseline and baseline.model_bytes:
            print(f"SUCCESS: Model bytes found in DB ({len(baseline.model_bytes)} bytes)")
        else:
            print("FAILURE: Model bytes not found in DB")
            return

        # 5. Delete disk file to force DB-only load
        model_path = baseline.model_path
        if os.path.exists(model_path):
            print(f"Deleting disk file to test DB fallback: {model_path}")
            os.remove(model_path)
        
        # 6. Load back from DB
        print("Attempting to load model back from DB (ignoring disk)...")
        loaded_model = _load_model_from_db(db, test_user_id)
        
        if loaded_model and loaded_model.is_trained:
            print("SUCCESS: Model reloaded from database binary!")
            
            # 7. Verify prediction capability
            X_test = np.random.rand(1, 12)
            score = loaded_model.predict_anomaly_score(X_test)
            print(f"Verification: Prediction score = {score:.4f}")
            print("--- TEST PASSED ---")
        else:
            print("FAILURE: Could not reload model from database")

    except Exception as e:
        print(f"Error during test: {e}")
        import traceback
        traceback.print_exc()
    finally:
        # Cleanup
        print("Cleaning up test data...")
        try:
            db.query(UserBaseline).filter(UserBaseline.user_id == test_user_id).delete()
            db.query(User).filter(User.id == test_user_id).delete()
            db.commit()
        except:
            db.rollback()
        db.close()

if __name__ == "__main__":
    test_model_persistence()
