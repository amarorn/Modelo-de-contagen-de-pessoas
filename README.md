# VisionCount — Sistema de Contagem e Análise de Pessoas em Tempo Real

Sistema completo de visão computacional para contagem, rastreamento e análise comportamental de pessoas e veículos em câmeras IP, HLS, RTSP ou webcam local. Combina detecção YOLO com rastreamento ByteTrack e um dashboard web em tempo real.

---

## Índice

- [Visão Geral](#visão-geral)
- [Arquitetura](#arquitetura)
- [Funcionalidades](#funcionalidades)
- [Requisitos](#requisitos)
- [Instalação](#instalação)
- [Configuração](#configuração)
- [Executando o Sistema](#executando-o-sistema)
- [Interface Web](#interface-web)
- [API REST](#api-rest)
- [Banco de Dados](#banco-de-dados)
- [Treinamento do Modelo](#treinamento-do-modelo)
- [Docker](#docker)
- [Scripts Utilitários](#scripts-utilitários)
- [Exportação de Dados](#exportação-de-dados)
- [Estrutura de Arquivos](#estrutura-de-arquivos)
- [Documentação Adicional](#documentação-adicional)

---

## Visão Geral

O VisionCount processa streams de vídeo em tempo real usando YOLOv8 para detectar pessoas e veículos, ByteTrack para rastreamento contínuo, e publica os resultados em um dashboard web interativo. Os dados são persistidos em SQLite (ou PostgreSQL) para análise histórica.

```
Câmera / Arquivo / RTSP / HLS
        │
        ▼
   YOLOv8 Detecção
        │
        ▼
   ByteTrack Rastreamento
        │
        ▼
  Linha / Polígono ROI  ──→  Contagem Entradas/Saídas
        │
        ├──→  Heatmap de Densidade
        ├──→  Vetores de Fluxo
        ├──→  Dwell Time (Permanência)
        ├──→  Detecção de Fila
        ├──→  Classificação de Gênero/Idade (opcional)
        └──→  Alertas (chapéu, cor do veículo, deriva de câmera)
                        │
                        ▼
              Flask API (porta 8080)
                        │
              ┌─────────┴──────────┐
              │                    │
         SQLite/PG              React UI
         (contagem.db)     (Vite + ApexCharts)
```

---

## Arquitetura

### Backend (Python / Flask)


| Módulo             | Arquivo                                        | Responsabilidade                                          |
| ------------------ | ---------------------------------------------- | --------------------------------------------------------- |
| Servidor Web       | `src/web_dashboard.py`                         | Flask API + streaming MJPEG (5.000+ linhas, 52 endpoints) |
| Inferência         | `src/infer_ultralytics_count.py`               | Loop de detecção + rastreamento                           |
| Rastreador         | ByteTrack via Ultralytics                      | Tracking multi-objeto                                     |
| Heatmap            | `src/heatmap_aggregator.py`                    | Grade 32×18, slots de 30 min                              |
| Dwell              | `src/dwell_accumulator.py`                     | Tempo de permanência por zona                             |
| Fluxo              | `src/flow_vector_grid.py` + `flow_insights.py` | Vetores direcionais + previsões                           |
| Hotspots           | `src/hotspot_scorer.py`                        | Áreas de alta atividade                                   |
| Alertas            | `src/alert_manager.py`                         | Orquestração de alertas                                   |
| Detecção de Chapéu | `src/alert_cap_detector.py`                    | CLIP zero-shot                                            |
| Cor de Veículo     | `src/alert_car_color.py`                       | Classificação por cor                                     |
| Gênero             | `src/sex_classifier_agg.py`                    | YOLOv8 Classify (opcional)                                |
| Idade              | `src/age_classifier_agg.py`                    | YOLOv8 Classify (opcional)                                |
| Deriva de Câmera   | `src/camera_drift.py`                          | Detecção MAD de movimento de câmera                       |
| Persistência       | `src/persistence/`                             | SQLAlchemy + modelos                                      |
| Streaming Kafka    | `src/persistence/emitter.py`                   | Eventos para Redpanda/Kafka (opcional)                    |


### Frontend (React / Vite)


| Tecnologia       | Versão |
| ---------------- | ------ |
| React            | 18.3.1 |
| TypeScript       | 5.5.3  |
| Vite             | 5.4.8  |
| ApexCharts       | 5.10.6 |
| react-apexcharts | 2.1.0  |


### Banco de Dados


| Arquivo             | Tamanho  | Conteúdo                            |
| ------------------- | -------- | ----------------------------------- |
| `data/contagem.db`  | ~8 MB    | Stats, heatmaps, zonas, calibrações |
| `data/audit_log.db` | ~300+ MB | Todos os eventos de tracking        |


---

## Funcionalidades

### Contagem e Rastreamento

- Detecção em tempo real com **YOLOv8** (nano, small, medium, large)
- Rastreamento contínuo com **ByteTrack** (troca suave entre stable/live)
- **Linha virtual** de contagem configurável pela UI (clique e arraste)
- **Polígonos ROI** para definir zonas de contagem independentes
- Contagem bidirecional: **Entradas** e **Saídas** separadas
- Agrupamento horário (24h) com identificação da **hora de pico**
- **Confiança de tracking**: score composto (YOLO + estabilidade + idade da track)

### Análise Espacial

- **Heatmap de densidade**: grade 32×18, decay configurável
- **Heatmap histórico**: por sessão, última hora, hoje, ou replay animado
- **Diff de heatmap**: compara dois períodos (ex: 1h vs hoje)
- **Vetores de fluxo**: setas direcionais de movimento por célula
- **Hotspots**: clusters de alta atividade com scoring
- **Dwell time**: tempo médio de permanência por zona e por célula

### Análise de Comportamento

- **Tempo médio e máximo** de permanência
- **Ocupação em tempo real**: moving / stationary / loitering
- **Detecção de fila**: tamanho, tempo de espera, saturação
- **ReID (Re-identificação)**: visitantes únicos, retornos, taxa de fidelidade
- **Previsão de fluxo**: próximos 15/30 minutos com recomendações

### Classificadores Opcionais

- **Gênero**: Feminino / Masculino (YOLOv8 Classify, ativado por env var)
- **Faixa etária**: Criança / Adolescente / Jovem / Adulto / Idoso
- Ambos exigem modelos treinados separadamente e são configurados por variável de ambiente

### Veículos

- Detecção e contagem de veículos por classe YOLO
- Rastreamento por cor: vermelho, laranja, amarelo, verde, ciano, azul, roxo, rosa, preto, branco, cinza, marrom
- Velocidade média em px/frame e px/s
- Contagem por zona (polígono de veículos)
- Alertas de cor e alerta de capacidade (cap detection via CLIP)

### Alertas e Monitoramento

- **Chapéu/boné**: alerta quando headwear é detectado (CLIP zero-shot)
- **Cor de veículo**: alerta para cor específica configurada
- **Fila saturada**: alerta quando fila excede limiar
- **Deriva de câmera**: detecta quando a câmera se moveu (MAD-based) com badge na UI
- **Toast notifications**: alertas visuais e sonoros no browser

### Gerenciamento de Fontes

- Webcam local (índice `/dev/videoX` ou `0`, `1`, etc.)
- Arquivo de vídeo (MP4, MKV, AVI)
- **RTSP** (câmeras IP, DVRs Intelbras, Hikvision, etc.)
- **HLS** (live streaming)
- **YouTube Live** (via yt-dlp)
- **Skyline Webcams** (extração automática de URL e token refresh)
- Presets salvos com nome e URL, gerenciados pela UI

### Exportação e Relatórios

- CSV de contadores da sessão (`/api/export`)
- CSV de estatísticas por zona (`/api/export/zones`)
- Relatório de dwell time em texto (`/api/export/dwell-report`)
- **Dashboard de Relatórios** com exportação inline

---

## Requisitos

### Hardware


| Componente    | Mínimo                         | Recomendado                |
| ------------- | ------------------------------ | -------------------------- |
| GPU           | NVIDIA CUDA 11+ (ex: GTX 1060) | RTX 3060 / RTX 4080        |
| RAM           | 8 GB                           | 16 GB                      |
| Armazenamento | 20 GB                          | 50 GB (datasets de treino) |
| CPU           | 4 núcleos                      | 8+ núcleos                 |


> **Nota:** Execução em CPU é possível mas com latência de 500+ ms/frame. Para produção, GPU é essencial.

### Software


| Dependência  | Versão                  |
| ------------ | ----------------------- |
| Python       | 3.10+                   |
| Node.js      | 18+                     |
| pnpm         | 8+                      |
| CUDA Toolkit | 12.4 (para GPU)         |
| FFmpeg       | Qualquer versão recente |


---

## Instalação

### 1. Clonar o repositório

```bash
git clone <url-do-repositorio>
cd Modelo-de-contagen-de-pessoas
```

### 2. Instalar dependências Python

```bash
pip install -r requirements.txt
```

Principais pacotes instalados:


| Pacote                    | Finalidade                                         |
| ------------------------- | -------------------------------------------------- |
| `ultralytics>=8.2.0`      | YOLO detecção, rastreamento e classificação        |
| `opencv-python>=4.8.0`    | I/O de vídeo e processamento de imagem             |
| `flask>=3.0.0`            | Servidor web e API REST                            |
| `flask-cors>=4.0.0`       | CORS para o frontend React                         |
| `sqlalchemy>=2.0.0`       | ORM para SQLite/PostgreSQL                         |
| `lap>=0.5.12`             | Algoritmo de atribuição (Hungarian) para ByteTrack |
| `open-clip-torch>=2.24.0` | Detecção de chapéu/boné (zero-shot)                |
| `kafka-python>=2.0.2`     | Streaming de eventos (opcional)                    |
| `psycopg2-binary>=2.9.9`  | Driver PostgreSQL (opcional)                       |


### 3. Instalar dependências do frontend

```bash
# Instalar pnpm se necessário
npm install -g pnpm

# Instalar dependências
cd apps/web
pnpm install
cd ../..
```

### 4. Configurar variáveis de ambiente

```bash
cp .env.example .env
# Editar .env com suas configurações
```

---

## Configuração

O arquivo `.env` controla todos os aspectos do sistema. As variáveis mais importantes:

### Modelo e Detecção


| Variável           | Padrão | Descrição                                               |
| ------------------ | ------ | ------------------------------------------------------- |
| `YOLO_INFER_MODEL` | —      | **Obrigatório.** Caminho para o arquivo `.pt` do modelo |
| `YOLO_INFER_CONF`  | `0.20` | Limiar de confiança de detecção (0.15–0.35)             |
| `YOLO_INFER_IMGSZ` | `1280` | Resolução de entrada (640, 960, 1280)                   |
| `YOLO_INFER_IOU`   | `0.50` | Limiar IoU para NMS                                     |
| `YOLO_MAX_DET`     | `600`  | Máximo de detecções por frame                           |
| `PERSON_CLASS_ID`  | `0`    | ID da classe pessoa no modelo                           |
| `YOLO_DEVICE`      | `0`    | Dispositivo: `0` (GPU), `cpu`, `auto`                   |
| `YOLO_NO_HALF`     | `0`    | `1` para forçar FP32 (desativa FP16)                    |


### Rastreamento (ByteTrack)


| Variável                 | Padrão                | Descrição                                                            |
| ------------------------ | --------------------- | -------------------------------------------------------------------- |
| `YOLO_TRACKER`           | `bytetrack_live.yaml` | Config do tracker (`bytetrack_live.yaml` ou `bytetrack_stable.yaml`) |
| `YOLO_TRACK_EMA`         | `0.45`                | Suavização temporal dos bounding boxes                               |
| `YOLO_TRACK_HOLD_FRAMES` | `1`                   | Frames para manter tracks perdidas                                   |
| `YOLO_HIDE_STALE_BOXES`  | `1`                   | Ocultar tracks não confirmadas                                       |


### Filtros de Geometria


| Variável                    | Padrão | Descrição                           |
| --------------------------- | ------ | ----------------------------------- |
| `YOLO_MIN_PERSON_AR`        | `0.98` | Aspect ratio mínimo da detecção     |
| `YOLO_MAX_PERSON_AR`        | `3.6`  | Aspect ratio máximo                 |
| `YOLO_MIN_PERSON_HEIGHT_PX` | `42`   | Altura mínima em pixels             |
| `YOLO_MAX_BOX_AREA_FRAC`    | `0.12` | Fração máxima do frame              |
| `YOLO_NO_SHAPE_FILTER`      | `1`    | `1` para desativar filtros de forma |


### Fonte de Vídeo


| Variável                        | Padrão | Descrição                                |
| ------------------------------- | ------ | ---------------------------------------- |
| `YOLO_WEB_SOURCE`               | —      | **Obrigatório.** URL ou índice da câmera |
| `YOLO_VID_STRIDE`               | `1`    | Pular frames (1 = todos, 2 = cada outro) |
| `YOLO_STREAM_BUFFER`            | `1`    | Buffering do stream                      |
| `OPENCV_FFMPEG_CAPTURE_OPTIONS` | —      | Opções extras para FFmpeg                |


Exemplos de `YOLO_WEB_SOURCE`:

```bash
# Webcam local
YOLO_WEB_SOURCE=0

# Arquivo de vídeo
YOLO_WEB_SOURCE=/path/to/video.mp4

# RTSP (câmera IP)
YOLO_WEB_SOURCE=rtsp://usuario:senha@192.168.1.100:554/stream

# HLS
YOLO_WEB_SOURCE=https://exemplo.com/live/stream.m3u8
```

### Linha e ROI


| Variável     | Padrão | Descrição                                  |
| ------------ | ------ | ------------------------------------------ |
| `COUNT_LINE` | —      | Linha de contagem: `x1,y1,x2,y2` em pixels |


Exemplo:

```bash
COUNT_LINE=640,0,640,720
```

### Servidor Web


| Variável                     | Padrão    | Descrição                             |
| ---------------------------- | --------- | ------------------------------------- |
| `WEB_HOST`                   | `0.0.0.0` | Endereço de bind                      |
| `WEB_PORT`                   | `8080`    | Porta HTTP                            |
| `WEB_HEATMAP`                | `1`       | Ativar heatmap (`0` para desativar)   |
| `YOLO_WEB_TRAIL_LEN`         | `72`      | Comprimento do rastro visual (frames) |
| `YOLO_WEB_HEADING`           | `1`       | Exibir seta de direção                |
| `YOLO_WEB_JPEG_QUALITY`      | `75`      | Qualidade JPEG do stream (1–100)      |
| `YOLO_WEB_PREVIEW_MAX_WIDTH` | `1280`    | Largura máxima do frame MJPEG         |


### Heatmap


| Variável      | Descrição                     |
| ------------- | ----------------------------- |
| `HEAT_SCALE`  | Escala da grade               |
| `HEAT_DECAY`  | Taxa de decay temporal        |
| `HEAT_RADIUS` | Raio de difusão por centroide |
| `HEAT_ALPHA`  | Opacidade da sobreposição     |
| `HEAT_GAIN`   | Ganho de intensidade          |


### Banco de Dados


| Variável       | Padrão                       | Descrição                 |
| -------------- | ---------------------------- | ------------------------- |
| `DATABASE_URL` | `sqlite:///data/contagem.db` | URL de conexão SQLAlchemy |


PostgreSQL:

```bash
DATABASE_URL=postgresql+psycopg2://usuario:senha@localhost:5432/contagem
```

### Classificadores Opcionais


| Variável           | Descrição                                                       |
| ------------------ | --------------------------------------------------------------- |
| `YOLO_SEX_MODEL`   | Caminho para o modelo de classificação de gênero (`.pt`)        |
| `YOLO_SEX_ABSTAIN` | Limiar de abstenção do classificador de gênero (padrão: `0.55`) |
| `YOLO_AGE_MODEL`   | Caminho para o modelo de classificação de faixa etária (`.pt`)  |
| `YOLO_AGE_ABSTAIN` | Limiar de abstenção do classificador de idade                   |


### Kafka / MLOps (Opcional)


| Variável                       | Descrição                                                |
| ------------------------------ | -------------------------------------------------------- |
| `KAFKA_BOOTSTRAP_SERVERS`      | Endereço do broker Redpanda/Kafka (ex: `127.0.0.1:9092`) |
| `TRAIN_USE_MLFLOW`             | `1` para ativar MLflow tracking                          |
| `ULTRALYTICS_HUB_API_KEY`      | Chave da API Ultralytics HUB                             |
| `ULTRALYTICS_PLATFORM_PROJECT` | Slug do projeto no HUB                                   |


---

## Executando o Sistema

### Desenvolvimento (backend + frontend separados)

```bash
# Terminal 1 — Backend Flask
bash scripts/run_web.sh

# Terminal 2 — Frontend React (HMR)
cd apps/web
pnpm dev
```

O backend sobe em `http://localhost:8080` e o frontend em `http://localhost:5173` (com proxy `/api` para o Flask).

### Produção (frontend embutido)

```bash
# Build do frontend
cd apps/web && pnpm build && cd ../..

# Iniciar servidor (serve frontend estático + API)
bash scripts/run_web.sh
```

Acesse `http://localhost:8080`.

### Com stream ao vivo

```bash
# YouTube Live
bash scripts/run_web.sh --youtube "https://www.youtube.com/watch?v=<ID>"

# Câmera mobile via browser
bash scripts/run_web_mobile.sh
```

### Modo somente inferência (sem UI web)

```bash
bash scripts/run_inference.sh
# Gera CSV em outputs/
```

---

## Interface Web

### Páginas disponíveis

#### Pessoas (Dashboard Principal)

Layout em 3 colunas: zonas à esquerda, vídeo ao centro, KPIs à direita.

- **Coluna esquerda**: Métricas por polígono (quando ROI poligonal ativa)
- **Coluna central**: Stream ao vivo + barra de ações (ROI, fonte, overlays)
- **Coluna direita**: Contadores em tempo real
  - Entradas, Saídas, Presentes agora, Passagens
  - Visitantes únicos (ReID), Veículos, Fila
  - FPS de inferência, moving / stationary / loitering
- **Grid de analytics**: Gráfico horário, gauge de ocupação, resumo de sessão
- **Insights de fluxo**: Previsões de 15/30 minutos
- **Demographics**: Gráficos de gênero e faixa etária (quando classificadores ativos)
- **Heatmap**: Histórico espacial com seletor de período e replay
- **Audit log**: Histórico de alterações de configuração

#### Veículos

Dashboard dedicado a detecção e análise de veículos:

- Sparklines de entradas/saídas em tempo real
- Breakdown por cor de veículo (12 cores)
- Velocidade média
- Configuração de alertas (cor, capacidade, beep sonoro)
- Zonas de veículos com ocupação por área

#### Zonas

Editor de ROI e zonas semânticas:

- Editor de linha de contagem (clique e arraste)
- Editor de polígono ROI (click points)
- Biblioteca de templates: Porta, Corredor, Faixa de Pedestres, etc.
- Hotspot overlay: composite / recente / histórico
- Métricas por zona: visitas, únicos, dwell time
- Auto-sugestão de linha e zonas por ML

#### Relatórios

Dashboard analítico de dados históricos da sessão:

- 6 KPIs: Entradas, Saídas, Fluxo Líquido, Visitantes Únicos, Hora de Pico, Tempo Médio
- Gráfico horário 24h de entradas e saídas
- Demographics (gênero + faixa etária)
- Gauge de ocupação e movimentação
- Análise de fila (tamanho, espera, status)
- Identificação de visitantes com taxa de retorno
- Tabela por zona (quando polígonos ativos)
- Previsões de fluxo
- Mapa de calor histórico
- Exportação CSV

#### Configurações

Interface para editar variáveis de ambiente em tempo real:

- Parâmetros YOLO (confiança, imgsz, IoU)
- Perfis predefinidos (Mall, Parking, Night, etc.)
- Overlays de vídeo

### Componentes de UI


| Componente           | Descrição                                            |
| -------------------- | ---------------------------------------------------- |
| `LiveFeed`           | Stream MJPEG com anotações (bboxes, trails, heading) |
| `RoiEditor`          | Editor de linha e polígono de contagem               |
| `SourceEditor`       | Gerenciador de fontes e presets de câmera            |
| `HeatmapCard`        | Heatmap com seletor de período, diff e replay        |
| `HourlyFlowChart`    | Gráfico de barras 24h (ApexCharts)                   |
| `DemographicsChart`  | Donuts de gênero e faixa etária (ApexCharts)         |
| `OccupancyGauge`     | Gauge radial de ocupação (ApexCharts)                |
| `FlowInsightsCard`   | Previsões e recomendações de fluxo                   |
| `FlowSummaryCard`    | Totais de sessão + hora de pico                      |
| `CameraDriftBadge`   | Indicador de deriva de câmera                        |
| `AuditLogPanel`      | Log de alterações de configuração                    |
| `AlertToast`         | Notificações de alerta (visual + sonoro)             |
| `ProfileSelector`    | Seletor de perfis de ambiente                        |
| `TrackingModeToggle` | Switch de modo de rastreamento                       |


### Tema Visual

O sistema usa o tema **Obsidian Signal** com CSS variables:

```css
--bg-base:     #06060A   /* preto verdadeiro */
--bg-surface:  #0B0B11   /* superfície elevada */
--bg-elevated: #11111A   /* cards */
--amber:       #FF9500   /* cor de destaque primária */
--cyan:        #00B4D8   /* destaque secundário */
--green:       #00D4AA   /* entradas / sucesso */
--red:         #FF3B5C   /* saídas / alertas */
```

Fontes: `Exo 2` (display), `DM Sans` (corpo), `JetBrains Mono` (números).

---

## API REST

O backend expõe **52 endpoints** REST. Documentação interativa disponível em `http://localhost:8080/docs`.

### Estatísticas e Métricas


| Método | Endpoint             | Descrição                                |
| ------ | -------------------- | ---------------------------------------- |
| GET    | `/api/stats`         | Stats em tempo real (polling 2s)         |
| GET    | `/api/insights/flow` | Previsões de fluxo (15/30 min)           |
| GET    | `/api/config`        | Configuração atual (modo, ROI, overlays) |
| GET    | `/api/settings`      | Variáveis de ambiente editáveis          |
| POST   | `/api/settings`      | Atualizar configurações                  |


**Resposta de `/api/stats` (principais campos):**

```json
{
  "entries": 1240,
  "exits": 980,
  "total_passages": 2220,
  "occupancy_now": 42,
  "moving_now": 28,
  "stationary_now": 10,
  "loitering_now": 4,
  "avg_dwell_sec": 87.3,
  "max_dwell_sec": 342.0,
  "hourly_entries": [0, 0, 187, 142],
  "hourly_exits":   [0, 0, 155, 130],
  "peak_hour": 14,
  "peak_flow": 187,
  "reid_unique_persons": 843,
  "reid_revisited": 312,
  "reid_avg_dwell_s": 94.2,
  "queue_size": 8,
  "queue_avg_wait_s": 45.2,
  "queue_saturated": false,
  "sex_female_agg": 524,
  "sex_male_agg": 716,
  "age_adult_agg": 891,
  "polygon_stats": [
    {
      "title": "Entrada Principal",
      "entries": 620,
      "exits": 510,
      "occupancy_now": 18,
      "avg_dwell_s": 12.4
    }
  ],
  "vehicle_entries": 85,
  "vehicle_exits": 79,
  "vehicle_total": 164
}
```

### Contagem e Calibração


| Método | Endpoint              | Descrição                               |
| ------ | --------------------- | --------------------------------------- |
| GET    | `/api/line`           | Obter posição atual da linha            |
| POST   | `/api/line`           | Definir linha (`x1,y1,x2,y2` em pixels) |
| POST   | `/api/line/reset`     | Resetar linha para padrão               |
| POST   | `/api/polygon`        | Definir polígono ROI com título         |
| POST   | `/api/polygon/reset`  | Resetar polígono                        |
| POST   | `/api/mode`           | Alternar modo (`line` / `polygon`)      |
| POST   | `/api/counters/reset` | Zerar todos os contadores               |


### Vídeo e Fontes


| Método | Endpoint                   | Descrição                 |
| ------ | -------------------------- | ------------------------- |
| GET    | `/video_feed`              | Stream MJPEG com overlays |
| GET    | `/api/source`              | Fonte de vídeo atual      |
| POST   | `/api/source`              | Trocar fonte de vídeo     |
| POST   | `/api/source/presets`      | Salvar preset             |
| GET    | `/api/source/presets/<id>` | Carregar preset           |
| PUT    | `/api/source/presets/<id>` | Atualizar preset          |
| DELETE | `/api/source/presets/<id>` | Remover preset            |


### Zonas e Templates


| Método | Endpoint                   | Descrição                               |
| ------ | -------------------------- | --------------------------------------- |
| GET    | `/api/zones`               | Listar zonas da câmera atual            |
| POST   | `/api/zones`               | Criar zona (polígono normalizado [0,1]) |
| PUT    | `/api/zones/<id>`          | Atualizar zona                          |
| DELETE | `/api/zones/<id>`          | Deletar zona                            |
| GET    | `/api/zones/<id>/stats`    | Histórico de métricas da zona           |
| GET    | `/api/zone-templates`      | Templates disponíveis                   |
| POST   | `/api/zones/from-template` | Criar zona a partir de template         |
| GET    | `/api/zones/vehicles/live` | Ocupação de veículos por zona           |


### Heatmap e Análise Espacial


| Método | Endpoint                    | Descrição                                        |
| ------ | --------------------------- | ------------------------------------------------ |
| GET    | `/api/heatmap/live`         | Heatmap em tempo real                            |
| GET    | `/api/heatmap/historical`   | Histórico por período (`1h`, `today`, `session`) |
| GET    | `/api/heatmap/replay`       | Slots de replay temporal                         |
| GET    | `/api/heatmap/diff`         | Diferença entre dois períodos                    |
| GET    | `/api/heatmap/grid_version` | Versão atual da grade                            |
| GET    | `/api/dwell/live`           | Heatmap de permanência                           |
| GET    | `/api/hotspots/live`        | Hotspots em tempo real                           |
| GET    | `/api/hotspots/historical`  | Hotspots históricos                              |
| GET    | `/api/flow/vectors`         | Vetores de direção de movimento                  |
| GET    | `/api/live/feet`            | Posições dos pés em tempo real                   |


### Alertas


| Método | Endpoint                  | Descrição                              |
| ------ | ------------------------- | -------------------------------------- |
| GET    | `/api/alerts`             | Alertas ativos (com parâmetro `since`) |
| POST   | `/api/alerts/config`      | Configurar limiares de alerta          |
| GET    | `/api/camera/drift`       | Status de deriva da câmera             |
| POST   | `/api/camera/drift/reset` | Resetar baseline de deriva             |


### Sugestões e IA


| Método | Endpoint                   | Descrição                          |
| ------ | -------------------------- | ---------------------------------- |
| GET    | `/api/suggest/line`        | Sugerir linha de contagem ideal    |
| GET    | `/api/suggest/zones`       | Sugerir zonas baseadas em hotspots |
| GET    | `/api/profiles`            | Perfis de ambiente disponíveis     |
| POST   | `/api/profiles/<id>/apply` | Aplicar perfil                     |


### Exportação e Auditoria


| Método | Endpoint                   | Descrição                               |
| ------ | -------------------------- | --------------------------------------- |
| POST   | `/api/export`              | Exportar CSV da sessão                  |
| POST   | `/api/export/zones`        | Exportar CSV de zonas                   |
| POST   | `/api/export/dwell-report` | Exportar relatório de permanência       |
| GET    | `/api/audit-log`           | Histórico de alterações de configuração |
| POST   | `/api/tracking/mode`       | Alternar rastreamento pessoa/veículo    |
| POST   | `/api/overlay`             | Ativar/desativar overlays               |


---

## Banco de Dados

### SQLite (padrão)

`**data/contagem.db**` — banco principal:


| Tabela                | Descrição                                        | Registros típicos   |
| --------------------- | ------------------------------------------------ | ------------------- |
| `stats_snapshots`     | Snapshot dos KPIs a cada ~2s (payload JSON)      | Milhares por sessão |
| `heatmap_slots`       | Grade 32×18 de densidade, slots de 30 min        | Centenas por dia    |
| `dwell_slots`         | Permanência por célula, slots de 30 min          | Centenas por dia    |
| `zone_stats_slots`    | Visits, unique IDs, avg_dwell por zona e slot    | Por slot de 30 min  |
| `camera_calibrations` | Configuração de linha/polígono por preset        | Dezenas             |
| `grid_versions`       | Histórico de versões da grade (por recalibração) | Dezenas             |
| `zones`               | Zonas ativas com polígono normalizado [0,1]      | Dezenas             |
| `zone_templates`      | Templates reutilizáveis de zona                  | Poucos              |
| `config_events`       | Eventos de alteração de configuração             | Dezenas             |


`**data/audit_log.db**` — log de eventos:


| Tabela         | Descrição                                                                                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit_events` | Cada evento de tracking: entradas, saídas, alertas, deriva. Colunas: `id`, `ts`, `wall_ts`, `session_id`, `event_type`, `track_id`, `confidence`, `x_norm`, `y_norm`, `metadata` |


> O `audit_log.db` cresce rapidamente (>300 MB em uso real). Configure rotação ou migre para PostgreSQL em produção.

### PostgreSQL (produção)

```bash
# Subir com Docker
docker compose -f docker-compose.kafka.yml up -d

# Configurar no .env
DATABASE_URL=postgresql+psycopg2://contagem:contagem@127.0.0.1:5433/contagem
```

### Consultas úteis

```python
import sqlite3, json

conn = sqlite3.connect('data/contagem.db')

# Entradas e saídas por hora no dia de hoje
rows = conn.execute("""
    SELECT
        strftime('%H', created_at) AS hora,
        AVG(json_extract(payload_json, '$.entries')) AS entradas,
        AVG(json_extract(payload_json, '$.exits')) AS saidas
    FROM stats_snapshots
    WHERE date(created_at) = date('now')
    GROUP BY hora
    ORDER BY hora
""").fetchall()

# Zonas com mais atividade
rows = conn.execute("""
    SELECT z.name, SUM(zs.visits) AS total_visits
    FROM zone_stats_slots zs
    JOIN zones z ON z.id = zs.zone_id
    GROUP BY z.name
    ORDER BY total_visits DESC
""").fetchall()
```

---

## Treinamento do Modelo

### Preparar dataset

```bash
# Estrutura esperada:
# dataset/
#   images/train/  images/val/
#   labels/train/  labels/val/

# Dividir dataset automaticamente
python scripts/split_dataset.py
```

### Treinar

```bash
# Local (requer GPU)
bash scripts/run_train.sh

# Validação apenas
bash scripts/val_person_only.sh

# Treino avançado com cross-validation
bash scripts/run_train_v2.sh
```

### Classificadores opcionais

```bash
# Treinar classificador de gênero
python scripts/train_gender_classify_7k.py

# Comparar modelos
python scripts/compare_models.py

# Auto-rotulagem semi-supervisionada
bash scripts/auto_label.sh
```

### Modelos


| Modelo           | Tarefa                                   | Variável de ambiente |
| ---------------- | ---------------------------------------- | -------------------- |
| YOLOv8n/s/m/l    | Detecção de pessoas e veículos           | `YOLO_INFER_MODEL`   |
| YOLOv8 Classify  | Classificação de gênero (opcional)       | `YOLO_SEX_MODEL`     |
| YOLOv8 Classify  | Classificação de faixa etária (opcional) | `YOLO_AGE_MODEL`     |
| CLIP (open-clip) | Detecção de chapéu/boné zero-shot        | Automático           |


Pesos ficam em `runs/detect/<experimento>/weights/best.pt`.

---

## Docker

### Treino com GPU

```bash
# Build da imagem de treino
docker compose build train

# Executar treino (com GPU)
docker compose run --rm --gpus all train
```

O `docker/Dockerfile.train` usa `pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime` como base.

### Stack completa com Kafka + PostgreSQL

```bash
# Subir Redpanda (Kafka-compatible) + PostgreSQL
docker compose -f docker-compose.kafka.yml up -d

# Parar
docker compose -f docker-compose.kafka.yml down
```

Serviços:

- **Redpanda**: `localhost:9092` (broker Kafka-compatible)
- **PostgreSQL**: `localhost:5433` (db: `contagem`, user/pass: `contagem`)

Após subir, configure no `.env`:

```env
KAFKA_BOOTSTRAP_SERVERS=127.0.0.1:9092
DATABASE_URL=postgresql+psycopg2://contagem:contagem@127.0.0.1:5433/contagem
```

Iniciar consumer Kafka:

```bash
bash scripts/run_kafka_consumer.sh
```

---

## Scripts Utilitários


| Script                                  | Descrição                                    |
| --------------------------------------- | -------------------------------------------- |
| `scripts/run_web.sh`                    | **Principal.** Inicia o sistema web completo |
| `scripts/run_web_mobile.sh`             | Câmera mobile via browser                    |
| `scripts/run_inference.sh`              | Inferência standalone sem UI, gera CSV       |
| `scripts/run_train.sh`                  | Treinar modelo YOLOv8                        |
| `scripts/run_train_v2.sh`               | Treino avançado com cross-validation         |
| `scripts/run_kafka_consumer.sh`         | Consumer Kafka → banco de dados              |
| `scripts/extract_frames_from_stream.sh` | Extrair frames de stream para dataset        |
| `scripts/extract_frames_opencv.py`      | Extração de frames via OpenCV                |
| `scripts/record_stream_to_mp4.sh`       | Gravar stream HLS/RTSP em MP4                |
| `scripts/split_dataset.py`              | Dividir dataset em train/val                 |
| `scripts/val_person_only.sh`            | Validação somente na classe pessoa           |
| `scripts/auto_label.sh`                 | Rotulagem semi-supervisionada                |
| `scripts/train_gender_classify_7k.py`   | Treinar classificador de gênero              |
| `scripts/compare_models.py`             | Benchmark comparativo de modelos             |
| `scripts/kill_port.sh`                  | Matar processo na porta (ex: 8080)           |


---

## Exportação de Dados

### Via UI (Dashboard de Relatórios)

1. Navegar até **Relatórios** no menu
2. Clicar **Exportar CSV** — baixa `count_summary_web_YYYYMMDD_HHMMSS.csv`
3. Clicar **Zonas CSV** — baixa estatísticas por zona (disponível quando polígonos ativos)

### Via API

```bash
# Exportar sessão atual
curl -X POST http://localhost:8080/api/export
# → {"csv_path": "outputs/count_summary_web_20260426_143000.csv"}

# Exportar zonas
curl -X POST http://localhost:8080/api/export/zones
# → {"csv_path": "outputs/zone_stats_20260426_143000.csv"}

# Relatório de dwell
curl -X POST http://localhost:8080/api/export/dwell-report
# → {"ok": true, "path": "outputs/dwell_report_20260426_143000.txt"}
```

### Estrutura dos CSVs gerados

`**outputs/count_summary_*.csv`:**

```
timestamp,entries,exits,net,occupancy
2026-04-26 14:00:00,42,38,4,18
2026-04-26 14:30:00,61,55,6,24
```

`**outputs/zone_stats_*.csv`:**

```
zone_id,name,slot_ts,visits,unique_ids,total_dwell_s,avg_dwell_s,p95_dwell_s,peak_occupancy
26,Entrada Principal,2026-04-26T14:00:00,416,118,4620.8,11.1,34.2,8
```

---

## Estrutura de Arquivos

```
Modelo-de-contagen-de-pessoas/
│
├── src/                              # Backend Python
│   ├── web_dashboard.py              # Flask API principal (5.000+ linhas, 52 endpoints)
│   ├── infer_ultralytics_count.py    # Runner de inferência standalone
│   ├── person_tracker.py             # Gerenciamento de tracks
│   ├── heatmap_aggregator.py         # Heatmap de densidade espacial
│   ├── dwell_accumulator.py          # Tempo de permanência
│   ├── flow_vector_grid.py           # Vetores de fluxo direcional
│   ├── flow_insights.py              # Previsões de fluxo
│   ├── hotspot_scorer.py             # Clustering de hotspots
│   ├── queue_detector.py             # Detecção de filas
│   ├── camera_drift.py               # Detecção de deriva de câmera (MAD)
│   ├── alert_manager.py              # Orquestração de alertas
│   ├── alert_cap_detector.py         # Detecção de chapéu (CLIP)
│   ├── alert_car_color.py            # Classificação de cor de veículo
│   ├── sex_classifier_agg.py         # Classificador de gênero (opcional)
│   ├── age_classifier_agg.py         # Classificador de faixa etária (opcional)
│   ├── roi_suggester.py              # Sugestão automática de ROI por ML
│   ├── stream_source_resolve.py      # Resolução de URLs de stream
│   ├── env_profiles.py               # Perfis de configuração predefinidos
│   ├── track_confidence.py           # Score de confiança de tracking
│   └── persistence/                  # Camada de persistência
│       ├── db.py                     # Configuração SQLAlchemy
│       ├── models.py                 # Modelos principais (StatsSnapshot, etc.)
│       ├── heatmap_models.py         # Modelos de heatmap (HeatmapSlot, GridVersion)
│       ├── dwell_models.py           # Modelos de dwell + zonas (DwellSlot, ZoneStatsSlot)
│       ├── zone_models.py            # Modelos de zona (Zone, ZoneTemplate)
│       ├── heatmap_store.py          # Store de heatmap
│       ├── dwell_store.py            # Store de dwell
│       ├── audit_log.py              # Log de eventos de tracking
│       ├── emitter.py                # Produtor Kafka (opcional)
│       └── consumer_service.py       # Consumidor Kafka (opcional)
│
├── apps/web/                         # Frontend React (monorepo pnpm)
│   └── src/
│       ├── App.tsx                   # Shell principal + roteamento por view state
│       ├── pages/
│       │   ├── Zones.tsx             # Editor de zonas e hotspots
│       │   ├── VehiclesDashboard.tsx # Dashboard de veículos
│       │   └── ReportsDashboard.tsx  # Dashboard de relatórios e exportação
│       ├── components/               # 32 componentes reutilizáveis
│       │   ├── LiveFeed.tsx          # Stream MJPEG com anotações
│       │   ├── RoiEditor.tsx         # Editor de linha e polígono
│       │   ├── HeatmapCard.tsx       # Heatmap com seletor de período
│       │   ├── HourlyFlowChart.tsx   # Gráfico de barras 24h
│       │   ├── DemographicsChart.tsx # Donuts de gênero/faixa etária
│       │   ├── OccupancyGauge.tsx    # Gauge de ocupação
│       │   ├── FlowInsightsCard.tsx  # Previsões de fluxo
│       │   ├── Header.tsx            # Navegação e status
│       │   └── ...
│       ├── hooks/                    # 15 custom hooks (polling da API)
│       │   ├── useStats.ts           # Polling /api/stats (2s)
│       │   ├── useFlowInsights.ts    # Polling /api/insights/flow (15s)
│       │   ├── useHeatmap.ts         # Polling heatmap ao vivo
│       │   └── ...
│       └── types/api.ts              # Interfaces TypeScript (Stats, PolygonStat, etc.)
│
├── configs/                          # Configurações YAML
│   ├── bytetrack_live.yaml           # ByteTrack otimizado para streams ao vivo
│   ├── bytetrack_stable.yaml         # ByteTrack para câmeras estáticas
│   ├── dataset.yaml                  # Dataset para treino
│   └── model_config.yaml             # Hiperparâmetros YOLO
│
├── scripts/                          # Scripts de automação (bash/python)
├── docker/                           # Dockerfiles e runtime
│   ├── Dockerfile.train              # Imagem de treino (pytorch + CUDA 12.4)
│   ├── Dockerfile.backend            # Imagem backend Flask/YOLO
│   ├── Dockerfile.frontend           # Imagem frontend React/Nginx
│   ├── start-backend.sh              # Entry point backend no container
│   └── nginx.frontend.conf           # Config Nginx do frontend
├── infra/k8s/                        # Base e overlays Kubernetes (dev/prod)
├── docs/                             # Documentação técnica (PT-BR)
├── data/                             # Bancos SQLite
│   ├── contagem.db                   # Banco principal (~8 MB)
│   └── audit_log.db                  # Log de eventos (~300+ MB)
├── outputs/                          # CSVs exportados e relatórios
├── runs/                             # Artefatos de treino YOLO (pesos)
├── .env.example                      # Template de variáveis (399 linhas)
├── requirements.txt                  # Dependências Python
├── package.json                      # Monorepo root (pnpm)
├── pnpm-workspace.yaml               # Workspace: apps/*
├── docker-compose.yml                # Treino GPU
└── docker-compose.kafka.yml          # Kafka (Redpanda) + PostgreSQL
```

---

## Documentação Adicional

Documentação técnica detalhada em `docs/` (em português):


| Arquivo                                              | Conteúdo                            |
| ---------------------------------------------------- | ----------------------------------- |
| `docs/01_arquitetura.md`                             | Arquitetura completa do sistema     |
| `docs/02_pipeline_treinamento.md`                    | Pipeline de dados e treinamento     |
| `docs/03_operacao_mlopps.md`                         | Operações, MLOps e implantação      |
| `docs/04_privacidade_etica.md`                       | LGPD, viés algorítmico e ética      |
| `docs/05_plano_validacao.md`                         | Metodologia de validação e métricas |
| `docs/06_ultralytics_treino.md`                      | Guia de treino via Ultralytics HUB  |
| `docs/07_web_online.md`                              | Publicação web e ngrok              |
| `docs/08_mobile_camera_browser.md`                   | Câmera mobile via browser           |
| `docs/11_guia_teste_pipeline_local_monitoramento.md` | Testes e monitoramento local        |


**API interativa:** `http://localhost:8080/docs` (Swagger UI)

**OpenAPI spec:** `http://localhost:8080/openapi.yaml`

---

## Kubernetes (dev/prod)

Foi adicionada uma estrutura de infraestrutura Kubernetes com separação de ambientes:

- `infra/k8s/base`: recursos compartilhados (app, dados e observabilidade).
- `infra/k8s/overlays/dev`: namespace `dev`, Gateway API e ajustes de desenvolvimento.
- `infra/k8s/overlays/prod`: namespace `prod`, Gateway API com TLS e ajustes de produção.

### Componentes provisionados

- Aplicação:
  - `visioncount-backend` (Flask/YOLO) como `Deployment` + `Service`
  - `visioncount-frontend` (Nginx) como `Deployment` + `Service`
  - `Gateway` + `HTTPRoute` com roteamento `/api` para backend e `/` para frontend
- Dados:
  - PostgreSQL (`StatefulSet`)
  - Redis (`Deployment` + PVC)
  - Redpanda/Kafka (`StatefulSet`)
  - MinIO (`Deployment` + PVC)
- Observabilidade:
  - Prometheus
  - Loki + Promtail
  - Grafana

### Comandos operacionais

```bash
# Subir ambiente dev
make k8s-dev-up

# Ver diff do ambiente prod (planejamento)
make k8s-prod-plan

# Aplicar em ambiente específico
make k8s-apply ENV=dev
make k8s-apply ENV=prod

# Validar básico
make k8s-smoke ENV=dev
```

### Configuração por ambiente

- `infra/k8s/overlays/dev/app-config.env`: configuração não sensível de dev.
- `infra/k8s/overlays/prod/app-config.env`: configuração não sensível de prod.
- `infra/k8s/overlays/prod/app-secrets.sops.yaml`: template para segredos com SOPS (não versionar segredos em claro).

### Pré-requisito do cluster

- O cluster precisa de suporte ao **Gateway API**:
  - CRDs `gateway.networking.k8s.io` instaladas
  - um controller compatível (ex.: NGINX Gateway, Envoy Gateway, Cilium Gateway)
  - `GatewayClass` nomeada `nginx` (ou ajuste `gatewayClassName` nos manifests)

### Rollback

```bash
# Histórico de revisões
kubectl -n prod rollout history deploy/visioncount-backend

# Voltar para revisão anterior
kubectl -n prod rollout undo deploy/visioncount-backend
kubectl -n prod rollout undo deploy/visioncount-frontend
```
