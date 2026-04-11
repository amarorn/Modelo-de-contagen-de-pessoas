"""Selecao de device torch/ultralytics com fallback seguro."""

from __future__ import annotations

import os

import torch


def resolve_device(device_arg: str) -> str:
    raw = (device_arg or "auto").strip()
    if raw.lower() == "auto":
        if torch.cuda.is_available():
            return "0"
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
        return "cpu"

    if _requests_cuda(raw) and not torch.cuda.is_available():
        print(
            "[device] AVISO: CUDA pedida mas torch.cuda.is_available() e False; "
            "a usar CPU. Verifique drivers NVIDIA, grupo 'video' (Linux), reinicie sessao. "
            f"CUDA_VISIBLE_DEVICES={os.environ.get('CUDA_VISIBLE_DEVICES', '')!r}"
        )
        return "cpu"

    return raw


def _requests_cuda(device_arg: str) -> bool:
    d = device_arg.strip().lower()
    if d in ("cpu", "mps"):
        return False
    if d in ("0", "cuda", "cuda:0") or d.startswith("cuda:"):
        return True
    if "," in d:
        return all(p.strip().isdigit() for p in d.split(",") if p.strip())
    return d.isdigit()
