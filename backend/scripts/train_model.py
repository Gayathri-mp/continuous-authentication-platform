#!/usr/bin/env python3
"""
ML Model Training Script
Trains Isolation Forest model on historical behavioral data
"""

import os
import sys
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix
import pickle

# Add parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal
from app.events.models import FeatureVector
from app.trust.ml_model import TrustModel
from app.config import settings
from app.utils.logger import logger


def load_training_data():
    """Load feature vectors from database."""
    db = SessionLocal()
    try:
        features = db.query(FeatureVector).all()
        
        if not features:
            logger.warning("No feature vectors found in database")
            return None
        
        # Convert to numpy array
        data = []
        for f in features:
            data.append([
                f.avg_key_hold_time or 0,
                f.avg_inter_key_interval or 0,
                f.typing_speed or 0,
                f.key_hold_std or 0,
                f.inter_key_std or 0,
                f.avg_mouse_speed or 0,
                f.avg_mouse_acceleration or 0,
                f.click_rate or 0,
                f.mouse_speed_std or 0,
                f.total_events,
                f.keystroke_count,
                f.mouse_count
            ])
        
        return np.array(data)
        
    finally:
        db.close()


def generate_synthetic_data(n_normal=1000, n_anomaly=100):
    """
    Generate synthetic behavioral data for training.
    
    Args:
        n_normal: Number of normal samples
        n_anomaly: Number of anomalous samples
    
    Returns:
        X: Feature matrix
        y: Labels (0=normal, 1=anomaly)
    """
    logger.info(f"Generating synthetic data: {n_normal} normal, {n_anomaly} anomalous")
    
    # Normal user behavior
    normal_data = []
    for _ in range(n_normal):
        normal_data.append([
            np.random.normal(0.1, 0.03),  # avg_key_hold_time
            np.random.normal(0.15, 0.05),  # avg_inter_key_interval
            np.random.normal(5, 1.5),  # typing_speed
            np.random.normal(0.02, 0.01),  # key_hold_std
            np.random.normal(0.05, 0.02),  # inter_key_std
            np.random.normal(500, 150),  # avg_mouse_speed
            np.random.normal(100, 30),  # avg_mouse_acceleration
            np.random.normal(0.5, 0.2),  # click_rate
            np.random.normal(100, 30),  # mouse_speed_std
            np.random.randint(50, 200),  # total_events
            np.random.randint(20, 100),  # keystroke_count
            np.random.randint(30, 100),  # mouse_count
        ])
    
    # Anomalous behavior (bot-like, too fast, too consistent)
    anomaly_data = []
    for _ in range(n_anomaly):
        anomaly_type = np.random.choice(['fast', 'consistent', 'slow'])
        
        if anomaly_type == 'fast':
            # Bot-like: very fast and consistent
            anomaly_data.append([
                np.random.normal(0.02, 0.005),  # Very short hold times
                np.random.normal(0.03, 0.005),  # Very short intervals
                np.random.normal(20, 2),  # Very fast typing
                np.random.normal(0.003, 0.001),  # Very low std
                np.random.normal(0.005, 0.001),  # Very low std
                np.random.normal(2000, 200),  # Very fast mouse
                np.random.normal(500, 50),  # High acceleration
                np.random.normal(2, 0.3),  # High click rate
                np.random.normal(50, 10),  # Low std
                np.random.randint(150, 300),
                np.random.randint(80, 150),
                np.random.randint(70, 150),
            ])
        elif anomaly_type == 'consistent':
            # Too consistent (automated)
            anomaly_data.append([
                0.1,  # Exactly same
                0.15,  # Exactly same
                5.0,  # Exactly same
                0.001,  # Almost zero std
                0.001,  # Almost zero std
                500,  # Exactly same
                100,  # Exactly same
                0.5,  # Exactly same
                10,  # Very low std
                np.random.randint(50, 200),
                np.random.randint(20, 100),
                np.random.randint(30, 100),
            ])
        else:  # slow
            # Suspiciously slow (possible session hijacking)
            anomaly_data.append([
                np.random.normal(0.5, 0.1),  # Very long hold times
                np.random.normal(1.0, 0.3),  # Very long intervals
                np.random.normal(1, 0.3),  # Very slow typing
                np.random.normal(0.1, 0.03),  # High variance
                np.random.normal(0.3, 0.1),  # High variance
                np.random.normal(100, 30),  # Slow mouse
                np.random.normal(20, 10),  # Low acceleration
                np.random.normal(0.1, 0.05),  # Low click rate
                np.random.normal(30, 10),  # Low std
                np.random.randint(10, 50),  # Low activity
                np.random.randint(5, 20),
                np.random.randint(5, 30),
            ])
    
    X = np.vstack([normal_data, anomaly_data])
    y = np.hstack([np.zeros(n_normal), np.ones(n_anomaly)])
    
    return X, y


def train_model(X, contamination=0.1):
    """
    Train Isolation Forest model.
    
    Args:
        X: Feature matrix
        contamination: Expected proportion of outliers
    
    Returns:
        Trained TrustModel
    """
    logger.info(f"Training model with {len(X)} samples")
    
    model = TrustModel()
    model.train(X, contamination=contamination)
    
    return model


def evaluate_model(model, X, y):
    """
    Evaluate model performance.
    
    Args:
        model: Trained TrustModel
        X: Feature matrix
        y: True labels (0=normal, 1=anomaly)
    """
    logger.info("Evaluating model...")
    
    # Predict anomaly scores
    scores = []
    for sample in X:
        score = model.predict_anomaly_score(sample)
        scores.append(score)
    
    scores = np.array(scores)
    
    # Convert scores to binary predictions (threshold at 0.5)
    predictions = (scores > 0.5).astype(int)
    
    # Classification report
    print("\n" + "="*60)
    print("CLASSIFICATION REPORT")
    print("="*60)
    print(classification_report(y, predictions, target_names=['Normal', 'Anomaly']))
    
    # Confusion matrix
    print("\n" + "="*60)
    print("CONFUSION MATRIX")
    print("="*60)
    cm = confusion_matrix(y, predictions)
    print(f"True Negatives:  {cm[0][0]}")
    print(f"False Positives: {cm[0][1]}")
    print(f"False Negatives: {cm[1][0]}")
    print(f"True Positives:  {cm[1][1]}")
    
    # Calculate metrics
    accuracy = (cm[0][0] + cm[1][1]) / cm.sum()
    precision = cm[1][1] / (cm[1][1] + cm[0][1]) if (cm[1][1] + cm[0][1]) > 0 else 0
    recall = cm[1][1] / (cm[1][1] + cm[1][0]) if (cm[1][1] + cm[1][0]) > 0 else 0
    f1 = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0
    fpr = cm[0][1] / (cm[0][1] + cm[0][0]) if (cm[0][1] + cm[0][0]) > 0 else 0
    
    print("\n" + "="*60)
    print("METRICS")
    print("="*60)
    print(f"Accuracy:  {accuracy:.4f}")
    print(f"Precision: {precision:.4f}")
    print(f"Recall:    {recall:.4f}")
    print(f"F1 Score:  {f1:.4f}")
    print(f"FPR:       {fpr:.4f}")
    print("="*60 + "\n")


def main():
    """Main training function."""
    print("\n" + "="*60)
    print("ADAPTIVE AUTH - ML MODEL TRAINING")
    print("="*60 + "\n")
    
    # Try to load real data from database
    X_real = load_training_data()
    
    if X_real is not None and len(X_real) > 100:
        logger.info(f"Using {len(X_real)} real samples from database")
        X = X_real
        y = None  # Unsupervised learning
        contamination = 0.1
    else:
        logger.info("Insufficient real data, generating synthetic data")
        X, y = generate_synthetic_data(n_normal=1000, n_anomaly=100)
        contamination = 0.1
    
    # Split data for evaluation (if we have labels)
    if y is not None:
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )
    else:
        X_train = X
        X_test = None
        y_test = None
    
    # Train model
    model = train_model(X_train, contamination=contamination)
    
    # Evaluate model (if we have test data with labels)
    if X_test is not None and y_test is not None:
        evaluate_model(model, X_test, y_test)
    
    # Save model
    model.save(settings.MODEL_PATH)
    logger.info(f"Model saved to {settings.MODEL_PATH}")
    
    print("\nTraining complete!")


if __name__ == "__main__":
    main()
