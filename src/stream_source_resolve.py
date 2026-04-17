"""Resolve fontes de video antes de abrir no OpenCV/Ultralytics.

Paginas HTML da SkylineWebcams embutem o manifesto HLS no player Clappr;
aceitar a URL da pagina (.html) evita copiar manualmente o m3u8.
"""

from __future__ import annotations

import os
import re
import ssl
from urllib.parse import parse_qs, urlencode, urljoin, urlparse
from urllib.request import Request, urlopen

_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

_SKYLINE_REFERER = "https://www.skylinewebcams.com/"


def apply_opencv_ffmpeg_capture_env(
    stream_src: str | int, *, base_opts: str | None = None
) -> None:
    """Ajusta OPENCV_FFMPEG_CAPTURE_OPTIONS para o backend FFmpeg do OpenCV.

    O manifesto HLS da Skyline em hd-auth.skylinewebcams.com costuma recusar o
    User-Agent default do libav; sem user_agent/referer o VideoCapture falha
    com 'Failed to open'. Preserva opcoes ja definidas (ex. fflags;nobuffer).
    """
    key = "OPENCV_FFMPEG_CAPTURE_OPTIONS"
    base = (base_opts if base_opts is not None else os.environ.get(key, "")).strip()
    u = str(stream_src).strip().lower() if isinstance(stream_src, str) else ""
    if "skylinewebcams.com" not in u:
        if base:
            os.environ[key] = base
        else:
            os.environ.pop(key, None)
        return
    sky = (
        "protocol_whitelist;file,http,https,tcp,tls,crypto|"
        f"user_agent;{_UA}|"
        f"referer;{_SKYLINE_REFERER}"
    )
    os.environ[key] = f"{base}|{sky}" if base else sky


def is_skylinewebcams_webcam_page(url: str) -> bool:
    u = url.strip().lower()
    if "skylinewebcams.com" not in u or "/webcam/" not in u:
        return False
    base = u.split("#", 1)[0].split("?", 1)[0].rstrip("/")
    return base.endswith(".html")


def _extract_base_href(html: str) -> str | None:
    m = re.search(r'<base\s+href=(["\'])([^"\']+)\1', html, re.I)
    if m:
        return m.group(2).strip()
    return None


def _extract_m3u8_from_html(html: str) -> str | None:
    m = re.search(r"""source\s*:\s*['"]([^'"]*\.m3u8[^'"]*)['"]""", html, re.I)
    if m:
        return m.group(1).strip()
    m2 = re.search(
        r'(https://hd-auth\.skylinewebcams\.com/[^\s"\'<>]+\.m3u8[^\s"\'<>]*)',
        html,
        re.I,
    )
    if m2:
        return m2.group(1).strip()
    return None


def _normalize_skyline_m3u8(url: str) -> str:
    u = url.strip()
    if not u:
        return u
    p = urlparse(u)
    host = p.netloc.lower()
    path = p.path.lower()
    if "skylinewebcams.com" not in host:
        return u
    if not (path.endswith("/livee.m3u8") or path.endswith("/live.m3u8")):
        return u
    q = parse_qs(p.query, keep_blank_values=False)
    token = (q.get("a") or [""])[0].strip()
    if not token:
        return u
    return f"https://hd-auth.skylinewebcams.com/live.m3u8?{urlencode({'a': token})}"


def resolve_skylinewebcams_page(page_url: str, timeout: float = 18.0) -> str:
    req = Request(page_url.strip(), headers={"User-Agent": _UA}, method="GET")
    ctx = ssl.create_default_context()
    with urlopen(req, timeout=timeout, context=ctx) as resp:
        raw = resp.read()
    html = raw.decode("utf-8", errors="replace")
    rel = _extract_m3u8_from_html(html)
    if not rel:
        raise ValueError(
            "Nao foi encontrado o stream m3u8 na pagina. A Skyline pode ter alterado o player; "
            "use o link m3u8 obtido nas ferramentas de rede do navegador."
        )
    if rel.startswith("http://") or rel.startswith("https://"):
        return _normalize_skyline_m3u8(rel)
    base = _extract_base_href(html) or "https://www.skylinewebcams.com/"
    return _normalize_skyline_m3u8(urljoin(base, rel))


def resolve_stream_source(raw: str) -> str:
    s = raw.strip()
    if not s or (s.isdigit() and len(s) <= 3):
        return s
    if is_skylinewebcams_webcam_page(s):
        return resolve_skylinewebcams_page(s)
    return _normalize_skyline_m3u8(s)
