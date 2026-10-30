FROM python:3.12-slim

# GIFTWISE_BIND 显式固定为 0.0.0.0：容器内必须监听所有接口，端口映射 (-p) 才能生效。
# 服务端源码默认值也是 0.0.0.0，这里写明是为了避免日后把默认值改成 127.0.0.1 时
# 静默打断容器发布（HEALTHCHECK 走回环，仍会通过，问题只在外部访问时才暴露）。
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    GIFTWISE_PORT=8000 \
    GIFTWISE_BIND=0.0.0.0

WORKDIR /app
COPY validator /app/validator
COPY deploy/server.py /app/deploy/server.py

RUN useradd --create-home --uid 10001 giftwise \
    && chown -R giftwise:giftwise /app
USER giftwise

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=2)"
CMD ["python", "-m", "deploy.server"]
