# CineArchive API — multi-stage build
FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/data/models/huggingface \
    PYTHONPATH=/app/src

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps

COPY pyproject.toml .
COPY src/ ./src/
RUN pip install --upgrade pip && pip install .

FROM base AS runtime

COPY --from=deps /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=deps /usr/local/bin /usr/local/bin
COPY --from=deps /app/src ./src/

RUN mkdir -p /data/videos /data/artifacts /data/db /data/models /data/library \
    && useradd --create-home --shell /bin/bash cinearchive \
    && chown -R cinearchive:cinearchive /app /data

# Ensure tokenizer + URL download deps always present (SigLIP / yt-dlp)
USER root
RUN pip install --no-cache-dir \
    "sentencepiece>=0.2.0" \
    "protobuf>=4.25.0" \
    "yt-dlp>=2024.8.0" \
    "curl_cffi>=0.7.0"
USER cinearchive

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "cinearchive.main:app", "--host", "0.0.0.0", "--port", "8000"]
