# =============================================================================
# Modelo de contagem de pessoas — variáveis de ambiente
# Carregado por: scripts/run_web.sh, run_web_mobile.sh, run_kafka_consumer.sh,
#   run_analytics_kafka_consumer.sh (e docker compose com env_file=.env se configurar).
# Reinicie o servidor após editar.
#
# Menos erros no arranque:
#   - Caminhos YOLO_* relativos ao repo (no Docker, ./runs monta-se em /app/runs).
#   - ANALYTICS_KAFKA_PUBLISH=0 se nao tiver Redpanda/Kafka a escutar.
#   - YOLO_SEX_MODEL / YOLO_AGE_MODEL vazios se nao existirem os .pt (evita ERRO no log).
#   - ALERT_CAP_ENABLED=0 sem pip install open-clip-torch.
#   - Nao commite chaves (Ultralytics, ngrok); use valores vazios e preencha so localmente.
# =============================================================================

# =============================================================================
# 1. GPU e precisao
# =============================================================================
# 0 = primeira GPU; auto = escolha automatica. YOLO_NO_HALF=1 forca FP32 (mais lento).
YOLO_DEVICE=0
YOLO_NO_HALF=0

# =============================================================================
# 2. Modelo de deteccao (pessoas) e classe
# =============================================================================
# Ranking no val set (classe Pessoa, 140 imgs):
#   exp-4               mAP50=0.691  mAP50-95=0.529   <- melhor (fine-tune do exp-25, 200 epochs)
#   exp-2               mAP50=0.617  mAP50-95=0.413
#   exp-35-person-only  mAP50=0.591  mAP50-95=0.391
#   exp                 mAP50=0.571  mAP50-95=0.378
#   exp-3               mAP50=0.555  mAP50-95=0.383
#   exp-34-all-valid    mAP50=0.540  mAP50-95=0.358
#   exp-25 (referencia) mAP50=0.460  mAP50-95=0.386 (recall 0.66 mas P=0.39)
# Relativo ao repo (funciona em host e no container com volume ./runs:/app/runs:ro).
YOLO_INFER_MODEL=runs/people_count/yolov8m-door-counter/weights/best.pt
# Indice da classe "pessoa" no modelo (0 = Pessoa / COCO person). ID errado = zero deteccoes.
PERSON_CLASS_ID=0
# IDs no .pt (exp-23): 0 Pessoa,1 Carro,2 Moto,3 Onibus,4 Van,5 caminhao,6 bicicleta (nc=7).
# A UI do Roboflow pode mostrar indices antigos; confira com: .venv/bin/python3 -c "from ultralytics import YOLO; print(YOLO('CAMINHO/exp-23.pt').names)"
COUNT_CLASS_IDS=0,1,2,3,4,5,6
# Ignorado pelo loop web: o filtro segue so as classes ligadas em «Rastreio» na UI.
YOLO_EXPAND_VEHICLE_CLASSES=1
# Fracao de YOLO_MIN_PERSON_HEIGHT_PX para aceitar bbox baixas (motas de cima); omitir = 0.20
YOLO_NONPERSON_MIN_H_FRAC=0.20
# Inferir todas as classes do .pt e filtrar depois (evita perda de moto com lista classes= errada)
YOLO_TRACK_NO_CLASSES_ARG=1

# =============================================================================
# 3. Inferencia YOLO (dashboard / stream)
# =============================================================================
# Limiar de confianca (dashboard). Webcam local: ver YOLO_WEB_INFER_CONF abaixo.
# Baixado de 0.15 -> 0.10 para igualar recall do exp-25 (0.66) com a precisao melhor do exp-35.
# Se aparecerem demasiados falsos positivos, sobe para 0.12 ou 0.15.
YOLO_INFER_CONF=0.05
YOLO_CONF_MULT_VEHICLE_ONLY=1
TRACK_CONF_VEHICLE_SUPPRESS_THRESHOLD=0.30
TRACK_CONF_SUPPRESS_THRESHOLD=0.35
# Frames minimos antes de contar cruzamento (menor = mais sensivel; 2 evita suprimir cruzamentos rapidos).
TRACK_CONF_MIN_AGE_FRAMES=2
# Opcional: limiar so para run_web.sh com webcam (ex. 0.02). Descomente se precisar.
# YOLO_WEB_INFER_CONF=0.02
# Baixado de 0.15 -> 0.08 para acompanhar YOLO_INFER_CONF.
YOLO_MIN_DET_CONF=0.08
# Subido de 1280 -> 1536: mais resolucao = melhor deteccao de pessoas pequenas/distantes.
# Se o FPS cair muito, volte para 1280 ou experimente 1408.
YOLO_INFER_IMGSZ=1280
YOLO_INFER_IOU=0.45
# Subido de 300 -> 500: cenas de corredor cheio podem ter muitas pessoas simultaneas.
YOLO_MAX_DET=250
YOLO_AUGMENT=0
YOLO_AGNOSTIC_NMS=1
# Stride 2/3 = mais FPS (1 em N frames na inferencia). Valor 0 no .env vira 1 no codigo.
YOLO_VID_STRIDE=1
# 0 = menor latencia (recomendado para HLS ao vivo); 1 = fila quando houver burst de decode.
YOLO_STREAM_BUFFER=0
# Opcional (web_dashboard): YOLO_BLUR_SAMPLE_EVERY=2, YOLO_SEX_UI_STRIDE=3 para aliviar CPU/GPU em multidao.

# =============================================================================
# 4. Webcam mobile (run_web_mobile.sh) — conf separada do dashboard
# =============================================================================
# Abaixo de ~0.25 costuma haver caixas na webcam; 0.25 aqui remove quase tudo.
YOLO_MOBILE_INFER_CONF=0.02

# =============================================================================
# 5. Linha virtual de contagem (pixels no frame; ex. 1280x720)
# =============================================================================
# Ajuste no browser ("Calibrar linha") ou poligono /roi. Mobile: MOBILE_COUNT_LINE no .env.example.
COUNT_LINE=640,50,640,700

# =============================================================================
# 6. Tracking (ByteTrack)
# =============================================================================
YOLO_TRACKER=configs/bytetrack_live.yaml
YOLO_TRACK_EMA=0.45
YOLO_TRACK_HOLD_FRAMES=1
YOLO_HIDE_STALE_BOXES=1

# =============================================================================
# 7. Filtros geometricos (bbox pessoa)
# =============================================================================
YOLO_NO_SHAPE_FILTER=1
YOLO_MIN_PERSON_AR=0.98
YOLO_MAX_PERSON_AR=3.6
YOLO_MAX_BOX_AREA_FRAC=0.12
YOLO_MIN_PERSON_HEIGHT_PX=42

# =============================================================================
# 8. Classificador de sexo (YOLO classify; opcional)
# =============================================================================
# Deteccao = best.pt acima. Sexo = classify (Female/Male). Vazio = desativado (menos erros no log).
YOLO_SEX_MODEL=
# Mais baixo = F/M aparecem mais rapido (mais erros). Mais alto = mais "?" ate ter confianca.
YOLO_SEX_ABSTAIN=0.45
# Altura minima bbox (px); desce se quiseres sexo mais cedo em figuras mais pequenas.
YOLO_SEX_MIN_BOX_HEIGHT_PX=110
# 1 = sem votacao por frames (mais rapido; F/M pode oscilar). 3-5 + SMOOTH_MIN 2-3 = rapido com pouco filtro.
YOLO_SEX_SMOOTH_WINDOW=1
YOLO_SEX_SMOOTH_MIN=5
YOLO_SEX_CLASSIFY_IMGSZ=228
YOLO_SEX_CROP_PAD=0.08

# =============================================================================
# 9. Classificador de idade (YOLO classify; opcional)
# =============================================================================
YOLO_AGE_MODEL=
YOLO_AGE_ABSTAIN=0.15

# =============================================================================
# 10. Fonte de video e OpenCV + FFmpeg
# =============================================================================
OPENCV_FFMPEG_CAPTURE_OPTIONS=fflags;nobuffer|max_delay;500000
# 0 = webcam; sem USB use URL ou preset. run_web.sh sem args: 0 + PRESETS -> 1. URL do JSON.
# Webcam com presets no .env: ./scripts/run_web.sh 0 (define YOLO_WEB_FORCE_WEBCAM=1).
YOLO_WEB_SOURCE=0
# YOLO_SKYLINE_WEBCAM_PAGE desactivado: quando definido, o resolver IGNORA o .m3u8 directo
# e tenta sempre ir buscar token novo a esta pagina. Se a pagina der 404, TODAS as fontes
# Skyline falham. Reactiva apenas se apontares a uma pagina .html valida da Skyline.
# YOLO_SKYLINE_WEBCAM_PAGE=https://www.skylinewebcams.com/en/webcam/united-states/new-york/new-york/duffy-square-times-square.html

# Preset Skyline: use pagina .html (o servidor obtem m3u8/token novo). NAO use hd-auth.../live.m3u8?a=... (expira).
YOLO_WEB_SOURCE_PRESETS=[{"id":"sky-1","label":"Skyline — Plaza Mayor (Cusco)","url":"https://www.skylinewebcams.com/en/webcam/peru/cusco/cusco/plaza-mayor.html"}]
# DVR Intelbras (exemplo): comente Skyline acima e descomente as linhas abaixo.
# OPENCV_FFMPEG_CAPTURE_OPTIONS=rtsp_transport;tcp|fflags;nobuffer|max_delay;500000
# YOLO_WEB_SOURCE=rtsp://user:258258@192.168.20.220:554/cam/realmonitor?channel=1&subtype=1
# YOLO_WEB_SOURCE_PRESETS=[{"id":"dvr-ch1","label":"Intelbras CH1","url":"rtsp://user:258258@192.168.20.220:554/cam/realmonitor?channel=1&subtype=1"},{"id":"dvr-ch2","label":"Intelbras CH2","url":"rtsp://user:258258@192.168.20.220:554/cam/realmonitor?channel=2&subtype=1"},{"id":"dvr-ch3","label":"Intelbras CH3","url":"rtsp://user:258258@192.168.20.220:554/cam/realmonitor?channel=3&subtype=1"}]
# Pagina .html Skyline: YOLO_WEB_SOURCE=https://www.skylinewebcams.com/.../webcam/....html
# FFMPEG_RELAY / FFMPEG_STATIC_DIR — reservados para UI de configuracao; o web_dashboard
# actual NAO le estes valores (captura e via OpenCV + OPENCV_FFMPEG_CAPTURE_OPTIONS em web_dashboard.py).
# FFMPEG_RELAY=1
# FFMPEG_STATIC_DIR=/caminho/para/pasta_com_ffmpeg_e_ffprobe

# =============================================================================
# 11. Servidor web e MJPEG
# =============================================================================
# WEB_HOST=0.0.0.0
WEB_PORT=8081
# WEB_MOBILE_PORT=8081
YOLO_WEB_PREVIEW_MAX_WIDTH=1280
YOLO_WEB_JPEG_QUALITY=75
YOLO_WEB_TRAIL_LEN=72
YOLO_WEB_HEADING=1
CAP_PROP_BUFFERSIZE=1

# Watchdog do stream de video (src/web_dashboard.py::_stream_watchdog):
# Detecta stall (HLS com token expirado, RTSP com disconnect silencioso, etc).
# SOFT (s): sem frame novo ha >=SOFT -> forca reopen (source_changed=True).
# HARD (s): sem frame novo ha >=HARD -> os._exit(3), scripts/run_web.sh reinicia.
# HLS Skyline: watchdog usa max(JPEG, tick do iterador). Se ambos ~parados, model.track() ficou bloqueado em read().
# Valores baixos (ex. 300s) disparam reopen com CDN lenta; 720s+ e mais tolerante.
YOLO_WATCHDOG_SOFT_S=720
YOLO_WATCHDOG_HARD_S=820
# Placeholder "FONTE OFFLINE" no /video_feed quando frame ficar mais velho que N s.
YOLO_FEED_STALE_S=15
# Limite de FPS do MJPEG no /video_feed (evita saturar threads Flask + GIL).
YOLO_MJPEG_MAX_FPS=14

# =============================================================================
# 12. Persistência SQL, relatórios (AnalyticsStore) e Kafka opcional
# =============================================================================
# Base de dados: SQLAlchemy. Postgres: exija `docker compose up -d postgres` saudavel na 5433.
# Se aparecer erro de ligacao, use SQLite local (um ficheiro em ./data/):
# DATABASE_URL=sqlite:///data/contagem.db
DATABASE_URL=postgresql+psycopg2://contagem:contagem@127.0.0.1:5433/contagem
# Variáveis usadas pelo compose (opcional; o compose já tem defaults):
# POSTGRES_USER=contagem
# POSTGRES_PASSWORD=contagem
# POSTGRES_DB=contagem
# POSTGRES_PORT=5433
# Smoke DB + opcional HTTP: export PYTHONPATH=src && python scripts/verify_analytics_db.py
# Com Flask a correr: ANALYTICS_SMOKE_URL=http://127.0.0.1:8081 ANALYTICS_SMOKE_CAMERA_ID=default

# Kafka / Redpanda (docker compose --profile kafka up -d) — fila stats/config (run_kafka_consumer.sh):
# KAFKA_BOOTSTRAP_SERVERS=127.0.0.1:9092
# KAFKA_TOPIC_PERSIST=contagem.persist
# KAFKA_CONSUMER_GROUP=contagem-persist

# Eventos de visão → tópico analytics (run_analytics_kafka_consumer.sh; requer pip install kafka-python):
# ANALYTICS_KAFKA_TOPIC=vision.analytics.events
# ANALYTICS_KAFKA_GROUP=contagem-analytics-vision
# 0 = nao tenta Kafka (recomendado sem Redpanda a correr). 1 = publica para ANALYTICS_KAFKA_*.
ANALYTICS_KAFKA_PUBLISH=0

# =============================================================================
# 13. Mapa de calor (WEB_HEATMAP=0 desliga no arranque)
# =============================================================================
WEB_HEATMAP=1
HEAT_SCALE=3
HEAT_DECAY=0.993
HEAT_RADIUS=14
HEAT_ALPHA=0.48
HEAT_GAIN=1.75

# =============================================================================
# 14. Processo de inferencia / display (X11)
# =============================================================================
INFER_NO_SHOW=1
# Em servidor/Docker sem X11, nao defina DISPLAY. No desktop com X11: export DISPLAY=:0
# DISPLAY=:0
HOTSPOT_RECENT_ALPHA=0.6
HOTSPOT_RECENT_WINDOW_S=900
HOTSPOT_HIST_DAYS=7
HOTSPOT_HIST_CACHE_TTL_S=60
EXTRACT_OPENCV_ONLY=1

# Drift câmara (posição): ver .env.example — com só THRESHOLD o score pode saturar a 100% em multidão.
CAM_DRIFT_POSITION_MAD_FRAC=1.0
CAM_DRIFT_POSITION_THRESHOLD=0.55
POLYGON_INSIDE_MIN_FRAMES=3
POLYGON_REENTRY_COOLDOWN_S=2.0
POLYGON_NEARBY_MERGE_S=1.0

# =============================================================================
# 15. MLOps e treino
# =============================================================================
INSTALL_MLOPS_DEPS=1
TRAIN_USE_MLFLOW=1

# =============================================================================
# 16. Ultralytics Platform (opcional)
# =============================================================================
# Preencha localmente se usar upload/sync Ultralytics (nao commite esta linha com chave real).
ULTRALYTICS_HUB_API_KEY=
ULTRALYTICS_PLATFORM_PROJECT=amaro-neto/count_person
ULTRALYTICS_PLATFORM_PROJECT_NAME=amaro-neto
ULTRALYTICS_PLATFORM_NAME=
ULTRALYTICS_PLATFORM_URL=https://platform.ultralytics.com
ULTRALYTICS_DATASET_SLUG=construction-ppe
ULTRALYTICS_UPLOAD_SAMPLE_PCT=100
ULTRALYTICS_CA_BUNDLE=
ULTRALYTICS_SSL_VERIFY=0

# =============================================================================
# 17. Tunel / utilitarios
# =============================================================================
# Token ngrok (opcional). Vazio = ignorado.
NOGROK_AUTHTOKEN=

# =============================================================================
# 18. Alertas (bip no dashboard quando detectar boné ou carro de cor X)
# =============================================================================
# Boné/chapéu: zero-shot com CLIP. Requer `pip install open-clip-torch`.
# 0 = desativado (evita dependencia open-clip e download ~350MB). 1 = boné/chapéu via CLIP.
ALERT_CAP_ENABLED=0
# Probabilidade minima CLIP para confirmar bone (0..1). Baixe se perder alertas.
ALERT_CAP_THRESHOLD=0.45

# Cores-alvo para carro (lista separada por virgula). Deixe vazio para desativar.
# Valores: vermelho, laranja, amarelo, verde, ciano, azul, roxo, rosa, preto, branco, cinza, marrom.
# Exemplo: ALERT_CAR_COLOR=vermelho,amarelo
ALERT_CAR_COLOR=
# Fracao minima de pixels com a cor no crop central do carro (0.05 e permissivo, 0.20 exigente).
ALERT_CAR_COLOR_MIN_SCORE=0.08

# Segundos minimos entre alertas do mesmo tipo para o mesmo track_id (evita spammar bip).
ALERT_COOLDOWN=3.0
# Tocar bell do terminal (\a) no servidor a cada alerta (beep em PC local).
ALERT_SERVER_BEEP=0

# =============================================================================
# 19. Resolucao rapida de erros
# =============================================================================
# - "Model not found" / YOLO: confirme que YOLO_INFER_MODEL existe sob ./runs (ou ajuste o caminho).
# - Postgres / connection refused: `docker compose up -d postgres` e espere healthy; ou SQLite em DATABASE_URL.
# - Kafka / analytics: mantenha ANALYTICS_KAFKA_PUBLISH=0 ate `docker compose --profile kafka` com broker OK.
# - Docker compose --profile app: o backend define DATABASE_URL e KAFKA_*; nao use caminhos /home/... no .env.
# - Web UI "Nao foi possivel atualizar": VITE_API_BASE vazio em dev (proxy) ou porta = WEB_PORT.
