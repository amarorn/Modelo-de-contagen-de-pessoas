# Pipeline Completo de Treinamento

## 1. Dados

### 1.1 Coleta

- Fonte primaria: videos reais da porta
- Cobertura: manha, tarde, noite, dias uteis e fim de semana
- Duracao inicial recomendada: 40 a 60 horas de video

### 1.2 Amostragem

- Extrair frames em taxa variavel (2 a 5 FPS para anotacao)
- Manter sequencias para treino de tracking

### 1.3 Rotulacao

- Detector:
  - bounding boxes da classe `person`
- Sexo (opcional):
  - label agregada em recortes, com revisao dupla
  - classe `unknown` permitida em baixa confianca

### 1.4 Qualidade

- taxa de discordancia entre anotadores < 5%
- auditoria de 10% das amostras por sprint

## 2. Preparacao

- split por tempo/cenario: train 70%, val 15%, test 15%
- evitar leakage de sequencias adjacentes entre splits
- augmentations:
  - brilho/contraste
  - blur leve
  - oclusao sintetica
  - perspective warp moderado

## 3. Treino do Detector

- arquitetura base: YOLOv8m (inicial)
- input: 640
- otimizador: AdamW ou SGD
- epocas: 80 a 150
- criterio de selecao: mAP50-95 e recall em pessoa

## 4. Treino do Tracker

- ByteTrack com ajuste de thresholds:
  - `track_high_thresh`
  - `track_low_thresh`
  - `match_thresh`
- validacao com metricas MOT (IDF1, HOTA)

## 5. Treino do Classificador de Sexo (Opcional)

- backbone leve (EfficientNet-B0 ou MobileNetV3)
- input em crop da pessoa
- balanceamento de classes no sampler
- metricas:
  - macro-F1
  - calibracao (ECE)
- politica de abstencao: se confianca < limiar, retorna `unknown`

## 6. Integracao e Regra de Contagem

- fusao detector + tracker + linha virtual
- regra de evento:
  - cada `track_id` pode gerar no maximo 1 `entry` ou 1 `exit` por cruzamento
- janela anti-repeticao para evitar bouncing

## 7. Avaliacao Final

- KPI principal: erro percentual de contagem por periodo
- KPI secundario: latencia media e p95
- testes por cenario:
  - fluxo baixo
  - fluxo alto
  - contraluz
  - oclusao

## 8. Empacotamento

- export ONNX/TensorRT para edge
- versionamento:
  - dados: DVC
  - modelo: registry com semver
  - experimento: MLflow

## 9. CI/CD MLOps

- trigger por novo dataset aprovado
- treino automatizado em runner GPU
- gates minimos antes de promover para producao

## 10. Criterio de Promocao

- F1 de contagem >= 0.92 no teste
- erro absoluto medio por hora <= 8%
- latencia p95 <= 180 ms/frame no hardware alvo
