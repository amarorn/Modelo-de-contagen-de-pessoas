# Fase 3 — Dwell, hotspots e zonas semanticas

## Resumo

- **Dwell por celula (32x18):** acumula segundos de permanencia por celula; persistido em `dwell_slots` (slots de 30 min, alinhados ao heatmap de passagens).
- **Zonas semanticas:** poligonos normalizados `[0,1]` por camera; templates builtin `entrance`, `retail_interior`, `checkout`; CRUD via API REST.
- **Hotspot score:** `composite = alpha * recente + (1-alpha) * historico`, com `recente` de uma janela movel (predefinida 900s) e `historico` dos ultimos 7 dias nas tabelas agregadas. Variaveis: `HOTSPOT_RECENT_ALPHA`, `HOTSPOT_RECENT_WINDOW_S`, `HOTSPOT_HIST_DAYS`, `HOTSPOT_HIST_CACHE_TTL_S`.

## API (Flask)

| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/api/dwell/live` | Payload de dwell normalizado (sessao atual) |
| GET | `/api/hotspots/live` | Score por celula + lista `zones` com score por zona |
| GET | `/api/hotspots/historical?window=recent|hist|composite` | Score sem buffer ao vivo (so historico DB + formula) |
| GET | `/api/zone-templates` | Catalogo de templates |
| POST | `/api/zone-templates` | Criar template customizado (`slug`, `name`, `zones`) |
| GET | `/api/zones?camera_id=` | Listar zonas ativas |
| POST | `/api/zones` | Criar zona (faz `bump_grid_version`) |
| POST | `/api/zones/from-template` | Instanciar template (`template_slug`) |
| PUT | `/api/zones/<id>` | Atualizar zona |
| DELETE | `/api/zones/<id>` | Soft-delete (`active_until`) |
| GET | `/api/zones/<id>/stats` | Series de `zone_stats_slots` |
| POST | `/api/export/zones` | CSV agregado por zona |
| POST | `/api/export/dwell-report` | Relatorio texto em `outputs/` |

## Onboarding por template

1. Escolher preset de camera (`/api/source/select` ou UI).
2. `POST /api/zones/from-template` com `{"template_slug":"entrance","camera_id":"<preset_id>"}`.
3. Ajustar poligonos via `PUT /api/zones/<id>` ou UI **Zonas** (Vite).
4. Opcional: `POST /api/zone-templates` para guardar layout como novo template.

## Grid version

Qualquer criacao/edicao/remocao de zona chama `bump_grid_version` para nao misturar series historicas com geometria antiga.
