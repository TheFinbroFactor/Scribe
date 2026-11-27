FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV SCRIBE_DATA_DIR=/app/data
ENV PYTHONUNBUFFERED=1
EXPOSE 80
CMD ["python", "backend/app.py"]
