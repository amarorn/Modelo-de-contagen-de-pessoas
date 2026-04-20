"""Zonas semanticas e templates (Fase 3)."""

from __future__ import annotations

from sqlalchemy import Boolean, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from persistence.models import Base


class ZoneTemplate(Base):
    """Template builtin ou criado pelo usuario (lista de poligonos nomeados)."""

    __tablename__ = "zone_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(String(96), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    zone_defs_json: Mapped[str] = mapped_column(Text, nullable=False)
    builtin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    default_weights_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[float] = mapped_column(Float, nullable=False)


class Zone(Base):
    """Zona ativa por camera; poligono normalizado [0,1] em polygon_json."""

    __tablename__ = "zones"
    __table_args__ = (
        Index("ix_zones_cam", "site_id", "camera_id", "grid_version"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    site_id: Mapped[str] = mapped_column(String(64), nullable=False, default="default")
    camera_id: Mapped[str] = mapped_column(String(64), nullable=False)
    template_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("zone_templates.id"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    zone_type: Mapped[str] = mapped_column(String(64), nullable=False, default="generic")
    polygon_json: Mapped[str] = mapped_column(Text, nullable=False)
    grid_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    active_from: Mapped[float] = mapped_column(Float, nullable=False)
    active_until: Mapped[float | None] = mapped_column(Float, nullable=True)
