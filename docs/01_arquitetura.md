# Arquitetura Completa

## 1. Visao Geral

Sistema de visao computacional no edge para detectar e rastrear pessoas que cruzam uma porta.
A contagem e feita por eventos de cruzamento de uma linha virtual orientada (entrada x saida).

Classificacao de sexo e opcional e deve ser tratada apenas como estatistica agregada, nunca para decisao individual.

## 2. Requisitos Funcionais

- RF1: contar pessoas que entram
- RF2: contar pessoas que saem
- RF3: expor contadores em tempo real por API
- RF4: registrar eventos com timestamp e confianca
- RF5: (opcional) classificar sexo por evento agregado

## 3. Requisitos Nao Funcionais

- RNF1: latencia de inferencia <= 150 ms/frame no edge
- RNF2: disponibilidade do servico >= 99%
- RNF3: precisao minima de contagem (F1) >= 0.92
- RNF4: tolerancia a oclusao parcial e variacao de iluminacao
- RNF5: seguranca e conformidade com LGPD

## 4. Componentes

1. Camera IP/USB:
- stream RTSP/USB com 1080p (preferencia 25-30 FPS)

2. Modulo de Ingestao:
- captura frames
- aplica preprocessamento (resize, normalizacao, mascara de ROI)

3. Detector de Pessoas:
- modelo CNN object detection
- retorna caixas, score e classe pessoa

4. Tracker:
- associa deteccoes em IDs persistentes
- reduz dupla contagem

5. Motor de Regras:
- linha de cruzamento orientada
- evento `entry` ou `exit` por ID

6. Classificador de Sexo (opcional):
- recebe crop da pessoa no momento do cruzamento
- retorna classe agregada com confianca

7. Armazenamento de Eventos:
- banco relacional/time-series
- logs tecnicos e metricas

8. API e Dashboard:
- consulta de contagem por intervalo
- visao operacional e alertas

9. Monitoramento:
- latencia, FPS, taxa de deteccao, drift

## 5. Arquitetura Fisica Sugerida

- Edge device (Jetson Orin Nano ou x86 com GPU leve)
- Processamento local de video para reduzir banda
- Envio apenas de eventos e metricas para nuvem
- Nuvem para observabilidade, historico e re-treinamento

## 6. Decisoes Tecnicas

- Deteccao + tracking ao inves de segmentation, por custo computacional menor
- Contagem por cruzamento de linha, por simplicidade e robustez
- Classificacao de sexo desacoplada da contagem, para nao degradar objetivo principal
- Processamento edge-first por privacidade e baixa latencia

## 7. Riscos Tecnicos

- Oclusao forte em horario de pico
- Mudanca de angulo da camera apos instalacao
- Baixa iluminacao e contra-luz
- Viabilidade etica e legal da classificacao de sexo

## 8. Mitigacoes

- Posicionar camera com vista zenital inclinada
- Definir ROI da porta e excluir fundo irrelevante
- Coletar dados em multiplos horarios
- Monitorar erro por faixa horaria e re-treinar periodicamente



# -----------------------------------------------------------------------------
# Ultralytics Platform (opcional)
# -----------------------------------------------------------------------------
ULTRALYTICS_HUB_API_KEY=ul_10d3f921e0831b3c99038154e4986a40502d5277
ULTRALYTICS_PLATFORM_PROJECT=amaro-neto/count_person
ULTRALYTICS_PLATFORM_PROJECT_NAME=amaro-neto
ULTRALYTICS_PLATFORM_NAME=
# Modelo: exp.pt (dominio treinado) ou yolov8m.pt / yolov8l.pt (COCO) para cenas genericas com muita gente
YOLO_INFER_MODEL=/Users/amaro/Downloads/exp.pt
ULTRALYTICS_PLATFORM_URL=https://platform.ultralytics.com
ULTRALYTICS_DATASET_SLUG=construction-ppe
ULTRALYTICS_UPLOAD_SAMPLE_PCT=100
#ULTRALYTICS_DATASET_ID= # dataset id do projeto Engefoto v
ULTRALYTICS_CA_BUNDLE=
ULTRALYTICS_SSL_VERIFY=0
# ID da classe "pessoa" no SEU modelo (veja log ao iniciar: classe filtrada id=...). COCO padrao: 0. Deixe vazio para resolver pelo nome "person".
PERSON_CLASS_ID=6


NOGROK_AUTHTOKEN=1Wka7bPItdP6S8gQPFyjXKPdOt1_3kwr75tLopH6ZTZnZU6Y3

# Deteccao: imgsz maior ajuda pessoas pequenas; conf muito baixo aumenta falso positivo
YOLO_INFER_CONF=0.15
YOLO_INFER_IMGSZ=1280
YOLO_INFER_IOU=0.45
YOLO_MAX_DET=250
# YOLO_AUGMENT=1 deixa mais lento mas pode ajudar noite/contraste (teste se tiver GPU)
YOLO_AUGMENT=0
YOLO_AGNOSTIC_NMS=0

# Mapa de calor: rastro mais longo + mais forte onde muita gente passa (reinicie o run_web.sh)
WEB_HEATMAP=1
HEAT_SCALE=3
HEAT_DECAY=0.993
HEAT_RADIUS=14
HEAT_ALPHA=0.48
HEAT_GAIN=1.75