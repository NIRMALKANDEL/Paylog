"""Online text reader for receipts the phone couldn't read: OCR.space (free tier).

Off by default. Turn it on with a free key from https://ocr.space/ocrapi :
    OCR_SPACE_API_KEY=K8...

Only used when the user taps "Try the online reader" after the phone's own
reader failed. The image goes to OCR.space, the text comes back, and the same
parser as on-device reading turns it into a draft the user reviews.
"""

import base64
import json
import logging
import urllib.error
import urllib.parse
import urllib.request

from flask import current_app

log = logging.getLogger(__name__)

ENDPOINT = "https://api.ocr.space/parse/image"
MAX_IMAGE_BYTES = 1024 * 1024  # free-tier limit; the app shrinks images before sending


class OnlineReaderError(Exception):
    """OCR.space couldn't read the image; the user falls back to typing it in."""


def ocr_enabled():
    return bool(current_app.config.get("OCR_SPACE_API_KEY"))


def read_lines(image_bytes, media_type, opener=None):
    """[{"text", "height"}, ...] for each line OCR.space found, top to bottom."""
    if not image_bytes or len(image_bytes) > MAX_IMAGE_BYTES:
        raise OnlineReaderError("That image is too large for the online reader. Try a smaller screenshot.")
    payload = urllib.parse.urlencode({
        "apikey": current_app.config["OCR_SPACE_API_KEY"],
        "base64Image": f"data:{media_type};base64,{base64.b64encode(image_bytes).decode()}",
        "language": "eng",
        "isOverlayRequired": "true",  # gives line positions and sizes
        "detectOrientation": "true",  # rotated photos
        "scale": "true",  # helps small text on low-resolution screenshots
        "OCREngine": "2",  # better with numbers and symbols like ₹
    }).encode()
    request = urllib.request.Request(ENDPOINT, data=payload, method="POST",
                                     headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with (opener or urllib.request.urlopen)(request, timeout=40) as response:
            data = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
        log.warning("OCR.space request failed: %s", exc)
        raise OnlineReaderError("The online reader is unavailable right now.") from exc

    if data.get("IsErroredOnProcessing") or not data.get("ParsedResults"):
        message = data.get("ErrorMessage")
        log.warning("OCR.space error: %s", message)
        raise OnlineReaderError("The online reader couldn't read this image.")
    lines = []
    for result in data["ParsedResults"]:
        overlay = (result.get("TextOverlay") or {}).get("Lines") or []
        if overlay:
            for line in sorted(overlay, key=lambda item: (item.get("MinTop") or 0)):
                text = (line.get("LineText") or "").strip()
                if text:
                    lines.append({"text": text, "height": line.get("MaxHeight")})
        else:
            lines += [{"text": t} for t in (result.get("ParsedText") or "").splitlines() if t.strip()]
    if not lines:
        raise OnlineReaderError("The online reader found no text in this image.")
    return lines
