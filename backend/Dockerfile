# TerraPulse API (optional: Excel import + guided model training). The web app runs without it.
# Works on any container host (Render, Railway, Fly.io, Hugging Face Spaces, ...), which set $PORT.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8000
WORKDIR /app

COPY requirements.txt pyproject.toml ./
RUN pip install --no-cache-dir -r requirements.txt

COPY src ./src
RUN pip install --no-cache-dir --no-deps -e .

EXPOSE 8000
# Allow the deployed site to call the API, e.g. TERRAPULSE_CORS_ORIGINS=https://terrapulse.vercel.app
CMD ["sh", "-c", "uvicorn terrapulse.api.app:app --host 0.0.0.0 --port ${PORT}"]
