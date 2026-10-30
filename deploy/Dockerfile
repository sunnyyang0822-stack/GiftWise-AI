FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    GIFTWISE_PORT=8000

WORKDIR /app
COPY validator /app/validator
COPY deploy/server.py /app/deploy/server.py

RUN useradd --create-home --uid 10001 giftwise \
    && chown -R giftwise:giftwise /app
USER giftwise

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=2)"
CMD ["python", "-m", "deploy.server"]
