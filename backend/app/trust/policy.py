from typing import Dict, Optional
from app.config import settings
from app.utils.logger import logger


class PolicyAction:
    """Policy action types."""
    CONTINUE = "continue"
    MONITOR = "monitor"
    STEPUP = "stepup"
    TERMINATE = "terminate"


def evaluate_policy(trust_score: float, session_status: str) -> Dict[str, any]:
    """
    Evaluate adaptive policy based on trust score.
    
    Args:
        trust_score: Current trust score (0-100)
        session_status: Current session status
        
    Returns:
        Policy decision with action and message
    """
    action = PolicyAction.CONTINUE
    message = "Session is trusted"
    require_stepup = False
    
    if trust_score >= settings.TRUST_THRESHOLD_OK:
        # High trust - continue normally
        action = PolicyAction.CONTINUE
        message = "Trust level: OK"
        
    elif trust_score >= settings.TRUST_THRESHOLD_MONITOR:
        # Medium trust - monitor but allow
        action = PolicyAction.MONITOR
        message = "Trust level: Monitoring for anomalies"
        
    elif trust_score >= settings.TRUST_THRESHOLD_STEPUP:
        # Low trust - require step-up authentication
        action = PolicyAction.STEPUP
        message = "Trust level: Step-up authentication required"
        require_stepup = True
        
    else:
        # Critical - terminate session
        action = PolicyAction.TERMINATE
        message = "Trust level: Critical - Session terminated"
    
    logger.info(f"Policy evaluated", extra={
        "trust_score": trust_score,
        "action": action,
        "require_stepup": require_stepup
    })
    
    return {
        "action": action,
        "message": message,
        "require_stepup": require_stepup,
        "trust_score": trust_score
    }


def should_terminate_session(trust_score: float) -> bool:
    """
    Determine if session should be terminated.
    
    Args:
        trust_score: Current trust score
        
    Returns:
        True if session should be terminated
    """
    return trust_score < settings.TRUST_THRESHOLD_STEPUP


def should_require_stepup(trust_score: float) -> bool:
    """
    Determine if step-up authentication is required.
    
    Args:
        trust_score: Current trust score
        
    Returns:
        True if step-up is required
    """
    return settings.TRUST_THRESHOLD_STEPUP <= trust_score < settings.TRUST_THRESHOLD_MONITOR
