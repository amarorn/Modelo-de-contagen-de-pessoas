# Treinamento na Plataforma Ultralytics

## 0. Treino direto de stream (pipeline pronto)

Comando unico (extracao -> pre-anotacao opcional -> split -> treino):

```bash
AUTO_LABEL=1 TRAIN_NOW=1 TEACHER=weights/best.pt \
  bash scripts/train_from_stream.sh 'rtsp://usuario:senha@ip:554/stream'
```

- `AUTO_LABEL=1`: usa `scripts/auto_label.sh` para gerar labels iniciais YOLO.
- `TRAIN_NOW=1`: dispara `scripts/run_train.sh` no final.
- Sem `AUTO_LABEL=1`, voce deve rotular manualmente antes de treinar.

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
   - `YOLO_MODEL`: base do treino, por exemplo `yolo11m.pt`, `yolo11l.pt`, `rtdetr-l.pt`, `rtdetr-x.pt` (mesma API `YOLO()` na Ultralytics).
   - `YOLO_CLASSES`: indices de classe **no YAML do dataset**, separados por virgula, para treinar **so** essas classes (ex.: dataset COCO completo mas apenas `person`: use `0` — em COCO 80 classes, `person` e indice **0**, nao 6). Se o teu dataset na plataforma tiver `person` como indice 6, usa `YOLO_CLASSES=6`.
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

YOLO11 ou RT-DETR, apenas uma classe (indice conforme o `data` YAML):

```bash
python3 src/train_ultralytics.py --model yolo11m.pt --data coco.yaml --classes 0
python3 src/train_ultralytics.py --model rtdetr-l.pt --data coco.yaml --classes 0
```

Com variavel de ambiente (via `run_train.sh` e `.env`): `YOLO_CLASSES=0`.

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
