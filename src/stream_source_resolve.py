"""Resolve fontes de video antes de abrir no OpenCV/Ultralytics.

Paginas HTML da SkylineWebcams embutem o manifesto HLS no player Clappr;
aceitar a URL da pagina (.html) evita copiar manualmente o m3u8.
"""

from __future__ import annotations

import os
import re
import ssl
import sys
from urllib.parse import parse_qs, urlencode, urljoin, urlparse
from urllib.request import Request, urlopen

_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

_SKYLINE_REFERER = "https://www.skylinewebcams.com/"


def _ffmpeg_opts_skyline_friendly(base: str) -> str:
    """Remove segmentos que atrapalham o 1.o segmento HLS (ex. fflags;nobuffer do run_web.sh)."""
    if not base.strip():
        return ""
    out: list[str] = []
    for seg in base.split("|"):
        s = seg.strip()
        if not s:
            continue
        low = s.lower()
        if low.startswith("fflags;") and "nobuffer" in low:
            continue
        out.append(s)
    return "|".join(out)


def is_skyline_hls_url(url: str) -> bool:
    u = url.strip().lower()
    return "skylinewebcams.com" in u and ".m3u8" in u


def probe_skyline_hls_url(url: str, timeout: float = 16.0) -> tuple[bool, str]:
    """HEAD/GET rapido: token ?a= expirado devolve 403 ou HTML sem #EXTM3U."""
    u = url.strip()
    if not u.lower().startswith(("http://", "https://")):
        return True, ""
    try:
        req = Request(
            u,
            headers={
                "User-Agent": _UA,
                "Referer": _SKYLINE_REFERER,
                "Accept": "*/*",
            },
            method="GET",
        )
        ctx = ssl.create_default_context()
        with urlopen(req, timeout=timeout, context=ctx) as resp:
            code = int(getattr(resp, "status", 200))
            if code >= 400:
                return False, f"HTTP {code}"
            chunk = resp.read(8192)
    except Exception as exc:
        err_s = str(exc).lower()
        if any(
            x in err_s
            for x in (
                "temporary failure",
                "name or service not known",
                "network is unreachable",
                "connection reset",
                "timed out",
            )
        ):
            return True, ""
        return False, str(exc)[:220]
    if not chunk:
        return False, "resposta vazia"
    if b"#EXTM3U" not in chunk and b"#EXTINF" not in chunk and b"#EXT-X-" not in chunk:
        if b"<html" in chunk[:200].lower():
            return False, "token invalido ou pagina HTML em vez de m3u8"
        return False, "resposta nao parece playlist HLS (#EXTM3U ausente)"
    return True, ""


def _looks_like_hls_http_url(url: str) -> bool:
    u = url.strip().lower()
    if not (u.startswith("http://") or u.startswith("https://")):
        return False
    if ".m3u8" in u:
        return True
    if "/chunks" in u and ("hls" in u or "live" in u or "media/" in u):
        return True
    return False


def _generic_hls_ffmpeg_opts(url: str) -> str | None:
    """Cabecalhos estilo browser para HLS em CDNs que bloqueiam o UA default do libav."""
    raw = url.strip()
    if not _looks_like_hls_http_url(raw):
        return None
    p = urlparse(raw)
    if not p.netloc:
        return None
    ref = f"{p.scheme}://{p.netloc}/"
    return (
        "protocol_whitelist;file,http,https,tcp,tls,crypto|"
        f"user_agent;{_UA}|"
        f"referer;{ref}"
    )


def apply_opencv_ffmpeg_capture_env(
    stream_src: str | int, *, base_opts: str | None = None
) -> None:
    """Ajusta OPENCV_FFMPEG_CAPTURE_OPTIONS para o backend FFmpeg do OpenCV.

    O manifesto HLS da Skyline em hd-auth.skylinewebcams.com costuma recusar o
    User-Agent default do libav; sem user_agent/referer o VideoCapture falha
    com 'Failed to open'. Preserva opcoes ja definidas (ex. fflags;nobuffer).

    Para outras URLs HLS (http(s) com .m3u8), junta o mesmo tipo de opcoes com
    referer no origin do manifesto — muitos servidores exigem-no para segmentos.
    """
    key = "OPENCV_FFMPEG_CAPTURE_OPTIONS"
    base = (base_opts if base_opts is not None else os.environ.get(key, "")).strip()
    u = str(stream_src).strip().lower() if isinstance(stream_src, str) else ""
    if "skylinewebcams.com" in u:
        # stimeout/timeout em microsegundos — HLS ao vivo pode demorar a entregar o 1.o segmento
        base_hls = _ffmpeg_opts_skyline_friendly(base)
        sky = (
            "protocol_whitelist;file,http,https,tcp,tls,crypto|"
            f"user_agent;{_UA}|"
            f"referer;{_SKYLINE_REFERER}|"
            "analyzeduration;10000000|"
            "probesize;10000000|"
            "max_delay;2000000|"
            "stimeout;40000000|"
            "timeout;40000000|"
            "reconnect;1|reconnect_streamed;1|reconnect_delay_max;4"
        )
        os.environ[key] = f"{base_hls}|{sky}" if base_hls else sky
        return
    if isinstance(stream_src, str):
        gen = _generic_hls_ffmpeg_opts(stream_src)
        if gen:
            os.environ[key] = f"{base}|{gen}" if base else gen
            return
    if base:
        os.environ[key] = base
    else:
        os.environ.pop(key, None)


def is_skylinewebcams_webcam_page(url: str) -> bool:
    u = url.strip().lower()
    if "skylinewebcams.com" not in u:
        return False
    path_only = u.split("#", 1)[0].split("?", 1)[0].rstrip("/")
    # Padrao classico: /webcam/<slug>.html
    if "/webcam/" in u and (path_only.endswith(".html") or path_only.endswith(".htm")):
        return True
    # Padrao novo de listagem/player: /live-webcams/.../<slug>
    if "/live-webcams/" in u and not path_only.endswith("/live-webcams"):
        return True
    return False


def _extract_base_href(html: str) -> str | None:
    m = re.search(r'<base\s+href=(["\'])([^"\']+)\1', html, re.I)
    if m:
        return m.group(2).strip()
    return None


def _extract_m3u8_from_html(html: str) -> str | None:
    # Player actual (JS minificado): source:'livee.m3u8?a=TOKEN', ou source:"..."
    m = re.search(r"""source\s*:\s*['"]([^'"]*\.m3u8[^'"]*)['"]""", html, re.I)
    if m:
        return m.group(1).strip()
    # URL absoluta em atributos ou JSON
    m2 = re.search(
        r'(https://hd-auth\.skylinewebcams\.com/[^\s"\'<>]+\.m3u8[^\s"\'<>]*)',
        html,
        re.I,
    )
    if m2:
        return m2.group(1).strip().rstrip(",;)")
    # Qualquer URL hd-auth com m3u8 (fallback)
    m3 = re.search(
        r"https://hd-auth\.skylinewebcams\.com/[a-zA-Z0-9_./-]+\.m3u8(?:\?[^\s\"'<>]*)?",
        html,
        re.I,
    )
    if m3:
        return m3.group(0).strip()
    # Token relativo sem aspas padrao (raro)
    m4 = re.search(
        r"(livee?\.m3u8\?a=[a-z0-9]+)",
        html,
        re.I,
    )
    if m4:
        return m4.group(1).strip()
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


def resolve_skylinewebcams_page(page_url: str, timeout: float = 22.0) -> str:
    page_url = page_url.strip()
    hdrs = {
        "User-Agent": _UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,pt;q=0.8",
        "Referer": _SKYLINE_REFERER,
        "Cache-Control": "no-cache",
    }
    req = Request(page_url, headers=hdrs, method="GET")
    ctx = ssl.create_default_context()
    try:
        with urlopen(req, timeout=timeout, context=ctx) as resp:
            raw = resp.read()
    except Exception as exc:
        raise ValueError(
            "Nao foi possivel obter a pagina Skyline (rede, SSL ou bloqueio). "
            f"Erro: {exc}. Tente copiar o URL .m3u8 diretamente (DevTools > Rede > m3u8)."
        ) from exc
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
    # Com preset antigo hd-auth...m3u8?a=... (token expira): definir YOLO_SKYLINE_WEBCAM_PAGE para a pagina .html
    page_override = os.environ.get("YOLO_SKYLINE_WEBCAM_PAGE", "").strip()
    if page_override and is_skylinewebcams_webcam_page(page_override):
        if is_skyline_hls_url(s):
            print(
                "[skyline] YOLO_SKYLINE_WEBCAM_PAGE: a obter m3u8 novo a partir da pagina .html "
                "(ignora o URL hd-auth do preset).",
                file=sys.stderr,
                flush=True,
            )
            return resolve_skylinewebcams_page(page_override)
    if is_skylinewebcams_webcam_page(s):
        return resolve_skylinewebcams_page(s)
    out = _normalize_skyline_m3u8(s)
    if is_skyline_hls_url(out):
        ok, msg = probe_skyline_hls_url(out, timeout=10.0)
        if not ok:
            print(
                "[skyline] URL m3u8 directo (hd-auth...?a=...) invalido ou expirado"
                + (f": {msg}" if msg else "")
                + ". Em YOLO_WEB_SOURCE_PRESETS use a pagina .html da camara, ou defina "
                "YOLO_SKYLINE_WEBCAM_PAGE com essa pagina.",
                file=sys.stderr,
                flush=True,
            )
    return out
