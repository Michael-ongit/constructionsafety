"""
Speech-to-text endpoint.

Routes:
  POST /api/speech-to-text  — upload audio → return transcribed text
"""

from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from speech_service import transcribe_audio, format_to_points

router = APIRouter(tags=["speech"])


@router.post("/api/speech-to-text")
async def speech_to_text(
    audio: UploadFile = File(...),
    format_result: bool = False,
):
    if not audio.content_type or not audio.content_type.startswith("audio/"):
        raise HTTPException(status_code=400, detail="Only audio files are accepted")
    try:
        audio_bytes = await audio.read()
        if not audio_bytes:
            raise HTTPException(status_code=400, detail="Empty audio file")
        raw_text = transcribe_audio(audio_bytes, audio.filename or "recording.webm")
        if not raw_text:
            return {"text": ""}
        result = format_to_points(raw_text) if format_result else raw_text
        return {"text": result}
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {e}")
