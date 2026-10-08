import os
import uuid
import aiofiles
from fastapi import UploadFile, HTTPException
from core.config import settings

ALLOWED_TYPES = {
    "image/jpeg", "image/png", "image/webp",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
}

async def save_upload(file: UploadFile, subfolder: str = "general") -> dict:
    """Save an uploaded file to disk and return its metadata."""
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail=f"File type '{file.content_type}' not allowed")

    contents = await file.read()

    size_mb = len(contents) / (1024 * 1024)
    if size_mb > settings.MAX_FILE_SIZE_MB:
        raise HTTPException(status_code=400, detail=f"File exceeds {settings.MAX_FILE_SIZE_MB}MB limit")

    ext = os.path.splitext(file.filename)[1]
    filename = f"{uuid.uuid4().hex}{ext}"
    folder = os.path.join(settings.UPLOAD_DIR, subfolder)
    os.makedirs(folder, exist_ok=True)
    filepath = os.path.join(folder, filename)

    async with aiofiles.open(filepath, "wb") as f:
        await f.write(contents)

    return {
        "file_path": filepath,
        "original_filename": file.filename,
        "mime_type": file.content_type,
        "file_size": len(contents),
    }
