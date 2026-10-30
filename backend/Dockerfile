FROM python:3.12-slim

# Allow proxy configuration during build and runtime.
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY
ARG http_proxy
ARG https_proxy
ARG no_proxy
ENV HTTP_PROXY=$HTTP_PROXY
ENV HTTPS_PROXY=$HTTPS_PROXY
ENV NO_PROXY=$NO_PROXY
ENV http_proxy=$http_proxy
ENV https_proxy=$https_proxy
ENV no_proxy=$no_proxy

# uvicorn reads WEB_CONCURRENCY (worker processes) and FORWARDED_ALLOW_IPS. The port
# is published on the host's loopback only, so the forwarded headers come from nginx.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    WEB_CONCURRENCY=2 \
    FORWARDED_ALLOW_IPS=*

WORKDIR /app

# requirements-aws-import.txt is installed only by the one-time AWS import.
COPY requirements.txt requirements-aws-import.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY hqg_dashboard ./hqg_dashboard
COPY seed ./seed

RUN useradd --system --no-create-home dashboard
USER dashboard

EXPOSE 5000

# Pending database migrations are applied at startup.
CMD ["uvicorn", "--factory", "hqg_dashboard.app:create_app", "--host", "0.0.0.0", "--port", "5000"]
