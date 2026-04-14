"""Leitura segura de valores do .env quando a shell exporta comentarios inline."""


def strip_env_comment(raw: str) -> str:
    s = raw.strip()
    if "#" in s:
        s = s.split("#", 1)[0].strip()
    return s
