# =============================================================================
# Modelo de contagem de pessoas — variáveis de ambiente
# Carregado por: scripts/run_web.sh, run_web_mobile.sh, run_kafka_consumer.sh,
#   run_analytics_kafka_consumer.sh (e docker compose com env_file=.env se configurar).
# Reinicie o servidor após editar.
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
YOLO_INFER_MODEL=/home/amaro-neto/Modelo-de-contagen-de-pessoas/runs/detect/runs/peoplecountv2/exp-6/weights/best.pt
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
# Stride 1 = cada frame. 2/3 = mais FPS, menos frames. Valor 0 no .env vira 1 no codigo.
YOLO_VID_STRIDE=1
# 0 = menor latencia; 1 = fila se aparecer "Waiting for stream".
YOLO_STREAM_BUFFER=1

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
# Deteccao = best.pt acima. Sexo = ficheiro task=classify (Female/Male). Vazio = desativado.
YOLO_SEX_MODEL=/home/amaro-neto/Modelo-de-contagen-de-pessoas/runs/detect/amaro-neto/count_person/yolov8m-door-counter11/weights/exp-sex-1.pt
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
YOLO_AGE_MODEL=/home/amaro-neto/Modelo-de-contagen-de-pessoas/runs/detect/amaro-neto/count_person/yolov8m-door-age-1/exp-age-1.pt
YOLO_AGE_ABSTAIN=0.15

# =============================================================================
# 10. Fonte de video e OpenCV + FFmpeg
# =============================================================================
OPENCV_FFMPEG_CAPTURE_OPTIONS=fflags;nobuffer|max_delay;500000
# 0 = webcam; sem USB use URL ou preset. run_web.sh sem args: 0 + PRESETS -> 1. URL do JSON.
YOLO_WEB_SOURCE=0
# YOLO_SKYLINE_WEBCAM_PAGE desactivado: quando definido, o resolver IGNORA o .m3u8 directo
# e tenta sempre ir buscar token novo a esta pagina. Se a pagina der 404, TODAS as fontes
# Skyline falham. Reactiva apenas se apontares a uma pagina .html valida da Skyline.
# YOLO_SKYLINE_WEBCAM_PAGE=https://www.skylinewebcams.com/en/webcam/united-states/new-york/new-york/duffy-square-times-square.html

YOLO_WEB_SOURCE_PRESETS=[{"id":"sky-1","label":"Skyline (m3u8)","url":"https://hd-auth.skylinewebcams.com/live.m3u8?a=dpcp0gh54eia46tcq5ip94gck7"}]
# DVR Intelbras (exemplo): comente Skyline acima e descomente as linhas abaixo.
# OPENCV_FFMPEG_CAPTURE_OPTIONS=rtsp_transport;tcp|fflags;nobuffer|max_delay;500000
# YOLO_WEB_SOURCE=rtsp://user:258258@192.168.20.220:554/cam/realmonitor?channel=1&subtype=1
# YOLO_WEB_SOURCE_PRESETS=[{"id":"dvr-ch1","label":"Intelbras CH1","url":"rtsp://user:258258@192.168.20.220:554/cam/realmonitor?channel=1&subtype=1"},{"id":"dvr-ch2","label":"Intelbras CH2","url":"rtsp://user:258258@192.168.20.220:554/cam/realmonitor?channel=2&subtype=1"},{"id":"dvr-ch3","label":"Intelbras CH3","url":"rtsp://user:258258@192.168.20.220:554/cam/realmonitor?channel=3&subtype=1"}]
# Pagina .html Skyline: YOLO_WEB_SOURCE=https://www.skylinewebcams.com/.../webcam/....html
FFMPEG_RELAY=1
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
# HLS/Skyline: buracos longos entre segmentos; valores baixos disparam reopen a mais (ver web_dashboard).
YOLO_WATCHDOG_SOFT_S=120
YOLO_WATCHDOG_HARD_S=220
# Placeholder "FONTE OFFLINE" no /video_feed quando frame ficar mais velho que N s.
YOLO_FEED_STALE_S=15
# Limite de FPS do MJPEG no /video_feed (evita saturar threads Flask + GIL).
YOLO_MJPEG_MAX_FPS=10

# =============================================================================
# 12. Persistência SQL, relatórios (AnalyticsStore) e Kafka opcional
# =============================================================================
# Base de dados: SQLAlchemy (events_raw, events_aggregated, trajectories, etc.).
# A app usa sempre uma BD — por defeito SQLite em ficheiro (./data/). No arranque aparece [db] Persistencia activa: ...
# Para Postgres: comente a linha SQLite abaixo, descomente a postgresql, suba: docker compose up -d  e pip install psycopg2-binary.
# DATABASE_URL=sqlite:///data/contagem.db
# Postgres (docker compose up -d na raiz; porta host 5433 por padrão):
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
# 1 = publica JSON após enqueue no worker; ativar só com broker acessível (evita trabalho inútil).
ANALYTICS_KAFKA_PUBLISH=1

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
# DISPLAY tipo :0 (X11). "1" nao e display valido.
DISPLAY=:1
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
ULTRALYTICS_HUB_API_KEY=ul_4fff8cc1412a7c6e67bb098678b1f4d758dae201
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
NOGROK_AUTHTOKEN=1Wka7bPItdP6S8gQPFyjXKPdOt1_3kwr75tLopH6ZTZnZU6Y3

# =============================================================================
# 18. Alertas (bip no dashboard quando detectar boné ou carro de cor X)
# =============================================================================
# Boné/chapéu: zero-shot com CLIP. Requer `pip install open-clip-torch`.
# 0 = desativado; 1 = ativa (1a inferencia baixa ~350MB do HuggingFace).
ALERT_CAP_ENABLED=1
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
