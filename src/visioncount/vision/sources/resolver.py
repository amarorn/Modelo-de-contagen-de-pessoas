"""Resolve fontes de video antes de abrir no OpenCV/Ultralytics.

Paginas HTML da SkylineWebcams embutem o manifesto HLS no player Clappr;
aceitar a URL da pagina (.html) evita copiar manualmente o m3u8.
"""

from __future__ import annotations

import json
import os
import re
import ssl
import sys
from urllib.parse import parse_qs, urlencode, urljoin, urlparse
from urllib.request import Request, urlopen

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
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
        # Timeouts em microsegundos.
        # stimeout/timeout = handshake TCP (não afeta leitura de segmentos .ts em HLS).
        # rw_timeout     = timeout de qualquer operação de I/O, incluindo leitura de segmento
        #                  HLS — este é o parâmetro que faz cap.read() desbloquear quando o
        #                  token expirou ou o CDN parou de responder.
        # reconnect/reconnect_streamed REMOVIDOS: causavam loop infinito 403→retry→403 quando
        # o token ?a= expirava, bloqueando model.track() indefinidamente.
        # Com rw_timeout=15s, cap.read() falha em ≤15s; loop externo re-scrapa a página .html.
        base_hls = _ffmpeg_opts_skyline_friendly(base)
        sky = (
            "protocol_whitelist;file,http,https,tcp,tls,crypto|"
            f"user_agent;{_UA}|"
            f"referer;{_SKYLINE_REFERER}|"
            "analyzeduration;10000000|"
            "probesize;10000000|"
            "max_delay;2000000|"
            "rw_timeout;15000000|"
            "stimeout;15000000|"
            "timeout;15000000"
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


def _walk_json_for_m3u8_url(obj: object, depth: int = 0) -> str | None:
    """Percorre JSON (Next.js __NEXT_DATA__, APIs embutidas) a procura de URL HLS."""
    if depth > 48:
        return None
    if isinstance(obj, str):
        s = obj.strip()
        low = s.lower()
        if ".m3u8" in low and s.startswith(("http://", "https://")):
            return s
        return None
    if isinstance(obj, dict):
        prefer_keys = (
            "contentUrl",
            "embedUrl",
            "streamUrl",
            "hlsUrl",
            "manifestUrl",
            "playlistUrl",
            "url",
            "src",
            "hls",
            "playlist",
            "stream",
        )
        for k in prefer_keys:
            if k in obj and isinstance(obj[k], str) and ".m3u8" in obj[k].lower():
                return obj[k].strip()
        for v in obj.values():
            found = _walk_json_for_m3u8_url(v, depth + 1)
            if found:
                return found
    elif isinstance(obj, list):
        for it in obj:
            found = _walk_json_for_m3u8_url(it, depth + 1)
            if found:
                return found
    return None


def _extract_m3u8_from_embedded_json(html: str, candidates_add) -> None:
    """JSON-LD, __NEXT_DATA__, __NUXT__, etc."""

    def _add(raw: str | None) -> None:
        candidates_add(raw)

    for sid in ("__NEXT_DATA__", "__NUXT__"):
        m = re.search(
            rf'<script[^>]+id=["\']{re.escape(sid)}["\'][^>]*>([\s\S]*?)</script>',
            html,
            re.I,
        )
        if not m:
            continue
        try:
            data = json.loads(m.group(1).strip())
        except (json.JSONDecodeError, TypeError, ValueError):
            continue
        found = _walk_json_for_m3u8_url(data)
        if found:
            _add(found)

    for m in re.finditer(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>([\s\S]*?)</script>',
        html,
        re.I,
    ):
        raw = m.group(1).strip()
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, TypeError, ValueError):
            continue
        items = data if isinstance(data, list) else [data]
        for item in items:
            found = _walk_json_for_m3u8_url(item)
            if found:
                _add(found)


def _extract_m3u8_from_html(html: str) -> str | None:
    """Extrai o primeiro URL de manifesto HLS plausivel do HTML da Skyline.

    O site muda o player (Clappr, HLS.js, JSON-LD); tentamos varios padroes.
    """

    def _clean(u: str) -> str:
        u = u.strip().rstrip(",;)}]\\").strip("'\"")
        u = u.replace("\\/", "/").replace("\\u002e", ".").replace("\\u002E", ".")
        return u.strip()

    candidates: list[str] = []

    def _add(raw: str | None) -> None:
        if not raw:
            return
        u = _clean(raw)
        if ".m3u8" not in u.lower():
            return
        if u.startswith("//"):
            u = "https:" + u
        if u not in candidates:
            candidates.append(u)

    html_variants = (
        html,
        html.replace("&amp;", "&"),
        html.replace("&amp;amp;", "&"),
    )

    for blob in html_variants:
        # 1) Chaves JS comuns no player (ordem: mais especifico primeiro)
        for pat in (
            r"""source\s*:\s*['"]([^'"]*\.m3u8[^'"]*)['"]""",
            r"""file\s*:\s*['"]([^'"]*\.m3u8[^'"]*)['"]""",
            r"""src\s*:\s*['"]([^'"]*\.m3u8[^'"]*)['"]""",
            r"""url\s*:\s*['"]([^'"]*\.m3u8[^'"]*)['"]""",
            r"""hlsUrl\s*[=:]\s*['"]([^'"]+)['"]""",
            r"""playback\s*:\s*['"]([^'"]*\.m3u8[^'"]*)['"]""",
            r"""manifestUrl\s*[=:]\s*['"]([^'"]+)['"]""",
            r"""playlistUrl\s*[=:]\s*['"]([^'"]+)['"]""",
            r"""["']hls["']\s*:\s*["']([^"']+)["']""",
            r"""streamUrl\s*[=:]\s*['"]([^'"]+)['"]""",
        ):
            for m in re.finditer(pat, blob, re.I):
                _add(m.group(1))

        # 2) Meta tags (algumas paginas expoem o stream)
        for pat in (
            r'<meta[^>]+property=["\']og:video(?::url)?["\'][^>]+content=["\']([^"\']+)["\']',
            r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:video(?::url)?',
            r'<meta[^>]+name=["\']twitter:player:stream["\'][^>]+content=["\']([^"\']+)["\']',
        ):
            mm = re.search(pat, blob, re.I)
            if mm:
                _add(mm.group(1))

        # 3) URLs absolutas em dominios Skyline / CDN historica
        for pat in (
            r'(https://hd-auth\.skylinewebcams\.com/[^\s"\'<>]+\.m3u8[^\s"\'<>]*)',
            r'(https://[^\s"\'<>]*skylinewebcams\.com[^\s"\'<>]*\.m3u8(?:\?[^\s"\'<>]*)?)',
            r'(https://[^\s"\'<>]*\.skylinewebcams\.com[^\s"\'<>]*\.m3u8(?:\?[^\s"\'<>]*)?)',
        ):
            for m in re.finditer(pat, blob, re.I):
                _add(m.group(1))

        # 3b) Qualquer URL absoluta terminando em .m3u8 (fallback por CDN nova)
        for m in re.finditer(
            r'https://[^\s"\'<>]+\.m3u8(?:\?[^\s"\'<>]*)?',
            blob,
            re.I,
        ):
            _add(m.group(0))

        # 4) Path relativo classico livee.m3u8?a=TOKEN (token alfanumerico longo)
        m4 = re.search(
            r"(livee?\.m3u8\?a=[A-Za-z0-9_-]{8,})",
            blob,
            re.I,
        )
        if m4:
            _add(m4.group(1))

        # 5) Strings JS com ponto escapado (\.m3u8)
        for m in re.finditer(
            r"['\"]([^'\"]*(?:\\\.|\.)m3u8[^'\"]*)['\"]",
            blob,
            re.I,
        ):
            _add(m.group(1))

    for blob in html_variants:
        _extract_m3u8_from_embedded_json(blob, _add)

    # 6) Primeiro candidato que parece URL; preferir hd-auth
    for pref in ("hd-auth", "skylinewebcams"):
        for c in candidates:
            if pref in c.lower():
                return c
    return candidates[0] if candidates else None


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
            "Nao foi encontrado o stream m3u8 na pagina. A Skyline pode ter alterado o player. "
            "Solucao: no Chrome/Edge, F12 > Rede > filtrar 'm3u8' > recarregar a pagina > copiar o URL "
            "https://hd-auth.../live.m3u8?a=... e coloque em YOLO_WEB_SOURCE ou no preset JSON em "
            "apps/web (url). Esse link expira; para estabilidade, volte a colar um m3u8 novo apos horas/dias."
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
