# Deployment Guide

## Prerequisites

- Docker & Docker Compose installed
- Git
- Modern web browser with WebAuthn support
- (Optional) Hardware security key or biometric authenticator

## Quick Start (Development)

### 1. Clone Repository
```bash
git clone <repository-url>
cd adaptive-continuous-auth
```

### 2. Start Services
```bash
docker-compose up -d
```

This will start:
- PostgreSQL database on port 5432
- FastAPI backend on port 8000
- Nginx frontend server on port 8080

### 3. Initialize Database
```bash
docker-compose exec backend python -m app.init_db
```

### 4. (Optional) Train ML Model
```bash
docker-compose exec backend python scripts/train_model.py
```

### 5. Access Application
- Frontend: http://localhost:8080
- Backend API: http://localhost:8000
- API Documentation: http://localhost:8000/docs

## Production Deployment

### Environment Variables

Create a `.env` file in the project root:

```env
# Database
DATABASE_URL=postgresql://user:password@db-host:5432/authdb

# JWT
JWT_SECRET=your-very-secure-secret-key-here
JWT_ALGORITHM=HS256
JWT_EXPIRATION_MINUTES=60

# WebAuthn
RP_ID=yourdomain.com
RP_NAME=Your Company Name
RP_ORIGIN=https://yourdomain.com

# Trust Thresholds
TRUST_THRESHOLD_OK=70
TRUST_THRESHOLD_MONITOR=40
TRUST_THRESHOLD_STEPUP=20

# CORS
CORS_ORIGINS=["https://yourdomain.com"]
```

### SSL/TLS Configuration

For production, you MUST use HTTPS. WebAuthn requires a secure context.

#### Option 1: Let's Encrypt with Certbot
```bash
# Install certbot
sudo apt-get install certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d yourdomain.com
```

#### Option 2: Custom Certificate
Update `nginx.conf`:
```nginx
server {
    listen 443 ssl http2;
    server_name yourdomain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    # ... rest of configuration
}
```

### Database Setup

#### PostgreSQL Production Configuration
```bash
# Create database
createdb authdb

# Create user
createuser -P authuser

# Grant privileges
psql -c "GRANT ALL PRIVILEGES ON DATABASE authdb TO authuser;"
```

#### Migrations (if using Alembic)
```bash
# Generate migration
alembic revision --autogenerate -m "Initial migration"

# Apply migration
alembic upgrade head
```

### Backend Deployment

#### Option 1: Docker
```bash
# Build image
docker build -t adaptive-auth-backend ./backend

# Run container
docker run -d \
  --name auth-backend \
  -p 8000:8000 \
  --env-file .env \
  adaptive-auth-backend
```

#### Option 2: Systemd Service
Create `/etc/systemd/system/adaptive-auth.service`:
```ini
[Unit]
Description=Adaptive Auth Backend
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/adaptive-auth/backend
Environment="PATH=/opt/adaptive-auth/backend/venv/bin"
EnvironmentFile=/opt/adaptive-auth/.env
ExecStart=/opt/adaptive-auth/backend/venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable adaptive-auth
sudo systemctl start adaptive-auth
```

### Frontend Deployment

#### Build React App
```bash
cd frontend
npm install
npm run build
```

#### Nginx Configuration
```nginx
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    # Frontend
    location / {
        root /var/www/adaptive-auth/dist;
        try_files $uri $uri/ /index.html;
    }
    
    # Backend API
    location /api/ {
        proxy_pass http://localhost:8000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Cloud Deployment

### AWS

#### Architecture
- **EC2**: Backend application
- **RDS**: PostgreSQL database
- **S3 + CloudFront**: Frontend static files
- **ALB**: Load balancer
- **Route 53**: DNS

#### Steps
1. Create RDS PostgreSQL instance
2. Launch EC2 instance with backend
3. Build and upload frontend to S3
4. Configure CloudFront distribution
5. Set up ALB with SSL certificate
6. Configure Route 53 DNS

### Google Cloud Platform

#### Architecture
- **Cloud Run**: Backend container
- **Cloud SQL**: PostgreSQL database
- **Cloud Storage + CDN**: Frontend
- **Cloud Load Balancing**: HTTPS load balancer

#### Steps
```bash
# Build and push container
gcloud builds submit --tag gcr.io/PROJECT_ID/adaptive-auth

# Deploy to Cloud Run
gcloud run deploy adaptive-auth \
  --image gcr.io/PROJECT_ID/adaptive-auth \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated
```

### Kubernetes

#### Deployment YAML
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: adaptive-auth-backend
spec:
  replicas: 3
  selector:
    matchLabels:
      app: adaptive-auth
  template:
    metadata:
      labels:
        app: adaptive-auth
    spec:
      containers:
      - name: backend
        image: adaptive-auth-backend:latest
        ports:
        - containerPort: 8000
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: auth-secrets
              key: database-url
```

## Monitoring & Logging

### Prometheus Metrics
Add to `backend/app/main.py`:
```python
from prometheus_fastapi_instrumentator import Instrumentator

Instrumentator().instrument(app).expose(app)
```

### Logging Configuration
```python
import logging
from pythonjsonlogger import jsonlogger

handler = logging.StreamHandler()
formatter = jsonlogger.JsonFormatter()
handler.setFormatter(formatter)
logger.addHandler(handler)
```

### Health Checks
- Backend: `http://localhost:8000/health`
- Database: Check connection in health endpoint

## Backup & Recovery

### Database Backup
```bash
# Automated daily backup
0 2 * * * pg_dump authdb > /backup/authdb_$(date +\%Y\%m\%d).sql
```

### Model Backup
```bash
# Backup ML model
cp data/models/isolation_forest.pkl /backup/model_$(date +\%Y\%m\%d).pkl
```

## Security Hardening

1. **Firewall**: Only expose ports 80, 443
2. **SSH**: Disable password auth, use keys only
3. **Updates**: Enable automatic security updates
4. **Secrets**: Use secrets manager (AWS Secrets Manager, HashiCorp Vault)
5. **Rate Limiting**: Configure nginx rate limiting
6. **WAF**: Enable Web Application Firewall
7. **Monitoring**: Set up intrusion detection

## Troubleshooting

### Backend won't start
```bash
# Check logs
docker-compose logs backend

# Check database connection
docker-compose exec backend python -c "from app.database import engine; engine.connect()"
```

### Frontend can't reach backend
- Check CORS settings in `backend/app/config.py`
- Verify nginx proxy configuration
- Check browser console for errors

### WebAuthn not working
- Ensure HTTPS is enabled (required for WebAuthn)
- Check RP_ID matches domain
- Verify browser supports WebAuthn

### Low trust scores
- Check if ML model is trained
- Verify feature extraction is working
- Review trust thresholds in configuration

## Performance Tuning

### Database
```sql
-- Add indexes
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_events_session_id ON behavioral_events(session_id);
CREATE INDEX idx_features_session_id ON feature_vectors(session_id);
```

### Backend
- Increase worker processes: `uvicorn app.main:app --workers 4`
- Enable connection pooling
- Cache frequently accessed data

### Frontend
- Enable gzip compression in nginx
- Set cache headers for static assets
- Use CDN for global distribution

## Maintenance

### Regular Tasks
- **Daily**: Check logs for errors
- **Weekly**: Review trust score distributions
- **Monthly**: Retrain ML model with new data
- **Quarterly**: Security audit and penetration testing

### Updating
```bash
# Pull latest code
git pull origin main

# Rebuild containers
docker-compose build

# Restart services
docker-compose up -d

# Run migrations
docker-compose exec backend alembic upgrade head
```

## Support

For issues and questions:
- GitHub Issues: [repository-url]/issues
- Documentation: [docs-url]
- Email: support@yourdomain.com
