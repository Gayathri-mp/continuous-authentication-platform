import os
import pickle
import numpy as np
from typing import Optional
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
from app.config import settings
from app.utils.logger import logger


class TrustModel:
    """ML model for trust scoring."""
    
    def __init__(self):
        self.model: Optional[IsolationForest] = None
        self.scaler: Optional[StandardScaler] = None
        self.is_trained = False
        
    def train(self, X: np.ndarray, contamination: float = 0.1):
        """
        Train Isolation Forest model.
        
        Args:
            X: Training data (feature vectors)
            contamination: Expected proportion of outliers
        """
        logger.info(f"Training model with {len(X)} samples")
        
        # Scale features
        self.scaler = StandardScaler()
        X_scaled = self.scaler.fit_transform(X)
        
        # Train Isolation Forest
        self.model = IsolationForest(
            contamination=contamination,
            random_state=42,
            n_estimators=100
        )
        self.model.fit(X_scaled)
        
        self.is_trained = True
        logger.info("Model training completed")
        
    def predict_anomaly_score(self, X: np.ndarray) -> float:
        """
        Predict anomaly score for feature vector.
        
        Args:
            X: Feature vector (single sample)
            
        Returns:
            Anomaly score (higher = more anomalous)
        """
        if not self.is_trained:
            logger.warning("Model not trained, using default score")
            return 0.0
        
        # Reshape if needed
        if X.ndim == 1:
            X = X.reshape(1, -1)
        
        # Scale features
        X_scaled = self.scaler.transform(X)
        
        # Get anomaly score
        # Isolation Forest returns -1 for outliers, 1 for inliers
        # decision_function returns negative scores for outliers
        score = self.model.decision_function(X_scaled)[0]
        
        # Normalize to 0-1 range (higher = more anomalous)
        # Typical range is around -0.5 to 0.5
        normalized_score = max(0, min(1, (-score + 0.5)))
        
        return normalized_score
        
    def save(self, path: str):
        """Save model to disk."""
        os.makedirs(os.path.dirname(path), exist_ok=True)
        
        with open(path, 'wb') as f:
            pickle.dump({
                'model': self.model,
                'scaler': self.scaler,
                'is_trained': self.is_trained
            }, f)
        
        logger.info(f"Model saved to {path}")
        
    def load(self, path: str) -> bool:
        """
        Load model from disk.
        
        Returns:
            True if loaded successfully, False otherwise
        """
        if not os.path.exists(path):
            logger.warning(f"Model file not found: {path}")
            return False
        
        try:
            with open(path, 'rb') as f:
                data = pickle.load(f)
                self.model = data['model']
                self.scaler = data['scaler']
                self.is_trained = data['is_trained']
            
            logger.info(f"Model loaded from {path}")
            return True
        except Exception as e:
            logger.error(f"Error loading model: {str(e)}")
            return False


# Global model instance
trust_model = TrustModel()

# Try to load existing model
trust_model.load(settings.MODEL_PATH)
