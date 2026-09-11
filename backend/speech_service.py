import os
import re
import tempfile
import speech_recognition as sr
from pydub import AudioSegment


def format_to_points(raw_text: str) -> str:
    if not raw_text:
        return ""
    pattern = r'\b(next|point\s*\d+|point\s*[a-zA-Z]+|bullet)\b'
    cleaned_text = re.sub(pattern, '|', raw_text, flags=re.IGNORECASE)
    cleaned_text = cleaned_text.replace('.', '|')
    raw_lines = cleaned_text.split('|')
    formatted_lines = []
    point_counter = 1
    for line in raw_lines:
        trimmed = line.strip()
        if trimmed:
            capitalized = trimmed[0].upper() + trimmed[1:]
            if not capitalized.endswith('.'):
                capitalized += "."
            formatted_lines.append(f"{point_counter}. {capitalized}")
            point_counter += 1
    return "\n".join(formatted_lines)


def transcribe_audio(audio_bytes: bytes, filename: str = "recording") -> str:
    ext = os.path.splitext(filename)[1].lower()
    SUPPORTED = {'.wav', '.flac', '.aiff', '.aif', '.ogg'}
    with tempfile.NamedTemporaryFile(prefix="speech_", suffix=ext, delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name
    try:
        wav_path = tmp_path
        if ext not in SUPPORTED:
            audio = AudioSegment.from_file(tmp_path)
            wav_path = tmp_path.rsplit('.', 1)[0] + '.wav'
            audio.export(wav_path, format='wav')
        recognizer = sr.Recognizer()
        with sr.AudioFile(wav_path) as source:
            recorded_audio = recognizer.record(source)
            raw_speech = recognizer.recognize_google(recorded_audio, language="en-US")
            return raw_speech
    except sr.UnknownValueError:
        return ""
    except sr.RequestError as e:
        raise RuntimeError(f"Speech recognition service unavailable: {e}")
    except Exception as e:
        raise RuntimeError(f"Transcription failed: {e}")
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        if 'wav_path' in locals() and wav_path != tmp_path and os.path.exists(wav_path):
            os.remove(wav_path)
