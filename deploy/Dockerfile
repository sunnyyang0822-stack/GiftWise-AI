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
# N-1（2026-10-31，PM 指令）：原来只 COPY deploy/server.py，导致交付镜像里根本没有
# deploy/observability.py 与 deploy/observable_server.py（"可观测入口不在交付镜像里"）。
# 改成整目录 COPY；上下文根 `.dockerignore` 已排除 deploy/evidence、__pycache__ 等，安全。
COPY deploy /app/deploy

RUN useradd --create-home --uid 10001 giftwise \
    && chown -R giftwise:giftwise /app
USER giftwise

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=2)"
# 默认入口**保持** deploy.server（= 有 I-2 读超时 + N-4 加锁日志的那个入口）。
# 可观测入口（/metrics、/readyz、JSONL 日志、优雅退出）**已随镜像交付但非默认入口**——
# 它默认不暴露 /metrics（该端点未鉴权，见 README 的公开风险说明），要用就显式启动：
#   docker run --rm -p 8000:8000 giftwise-validator:<tag> python -m deploy.observable_server
CMD ["python", "-m", "deploy.server"]
