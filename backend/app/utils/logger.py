import logging
import sys
from pythonjsonlogger import jsonlogger


def setup_logger(name: str = "auth_platform") -> logging.Logger:
    """
    Set up structured JSON logger.
    
    Args:
        name: Logger name
        
    Returns:
        Configured logger instance
    """
    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)
    
    # Console handler
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(logging.INFO)
    
    # JSON formatter
    formatter = jsonlogger.JsonFormatter(
        '%(asctime)s %(name)s %(levelname)s %(message)s',
        timestamp=True
    )
    handler.setFormatter(formatter)
    
    logger.addHandler(handler)
    
    return logger


# Global logger instance
logger = setup_logger()
