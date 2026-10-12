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

IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}


async def save_upload(
    file: UploadFile,
    subfolder: str = "general",
    *,
    filename: str | None = None,
    allowed_types: set | None = None,
) -> dict:
    """Save an uploaded file to disk and return its metadata.

    ``filename`` (without extension) replaces the random name, and
    ``allowed_types`` narrows the accepted content types.
    """
    if file.content_type not in (allowed_types or ALLOWED_TYPES):
        raise HTTPException(status_code=400, detail=f"File type '{file.content_type}' not allowed")

    contents = await file.read()

    size_mb = len(contents) / (1024 * 1024)
    if size_mb > settings.MAX_FILE_SIZE_MB:
        raise HTTPException(status_code=400, detail=f"File exceeds {settings.MAX_FILE_SIZE_MB}MB limit")

    ext = os.path.splitext(file.filename)[1]
    filename = f"{filename or uuid.uuid4().hex}{ext.lower() if filename else ext}"
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
