from app.database import SessionLocal, init_db
from app.auth import models
import uuid

def test_db_persistence():
    print("Initializing database...")
    from app.auth import models
    init_db()
    db = SessionLocal()
    try:
        username = "manual_test_user"
        print(f"Creating user {username}...")
        
        # Check if exists
        user = db.query(models.User).filter(models.User.username == username).first()
        if user:
            print("User already exists, deleting...")
            db.delete(user)
            db.commit()
            
        user = models.User(username=username, display_name=username)
        db.add(user)
        db.commit()
        db.refresh(user)
        print(f"User created with ID: {user.id}")
        
        # Check if saved
        db2 = SessionLocal()
        user2 = db2.query(models.User).filter(models.User.username == username).first()
        if user2:
            print("SUCCESS: User persists in DB!")
        else:
            print("FAILURE: User did not persist!")
        db2.close()
        
    except Exception as e:
        print(f"DB Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    test_db_persistence()
