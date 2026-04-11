# Treinamento na Plataforma Ultralytics

## 1. Preparar Dataset no Formato YOLO

Estrutura minima:

- `data/person_count/images/train`
- `data/person_count/images/val`
- `data/person_count/images/test`
- `data/person_count/labels/train`
- `data/person_count/labels/val`
- `data/person_count/labels/test`

Arquivo de classes e paths: `configs/dataset.yaml`.

## 2. Configurar .env

1. Copiar `.env.example` para `.env`.
2. Preencher `ULTRALYTICS_HUB_API_KEY`.
3. Opcionalmente ajustar parametros `YOLO_*`.
   - em Mac Apple Silicon, prefira `YOLO_DEVICE=auto` (usa `mps` ou `cpu`).
4. Se quiser usar dataset da Ultralytics por slug, defina `ULTRALYTICS_DATASET_SLUG` no `.env`.
   - exemplo: `ULTRALYTICS_DATASET_SLUG=construction-ppe` usa `construction-ppe.yaml`.

`run_train.sh` carrega automaticamente variaveis de `.env`.

## 3. Treino Local/HUB com Ultralytics

Comando:

```bash
bash scripts/run_train.sh
```

Ou manualmente:

```bash
python3 src/train_ultralytics.py --model yolov8m.pt --data configs/dataset.yaml
```

Se `ULTRALYTICS_HUB_API_KEY` estiver definido, o script faz login no HUB e envia metricas.
Se o HUB estiver indisponivel, o script faz fallback automatico para treino local.

## 4. Saidas do Treino

- Melhor peso: `<project>/<name>/weights/best.pt`
- Ultimo peso: `<project>/<name>/weights/last.pt`
- Metricas e curvas: pasta do experimento em `<project>/<name>`

## 5. Inference e Contagem

```bash
bash scripts/run_inference.sh
```

Com RTSP:

```bash
bash scripts/run_inference.sh rtsp://usuario:senha@ip:554/stream
```
