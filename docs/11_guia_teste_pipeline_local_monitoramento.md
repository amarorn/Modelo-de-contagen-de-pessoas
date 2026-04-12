# Guia Pratico: Testar Pipeline Local, Monitorar e Subir em Plataforma

## 1. Objetivo

Este guia consolida o fluxo operacional para:

- validar pipeline de treino local
- validar pipeline de inferencia
- monitorar metricas de treino e operacao
- promover execucao para modo plataforma (Ultralytics HUB)

## 2. Referencias da documentacao

Antes de executar, use estes documentos como base:

- `docs/02_pipeline_treinamento.md`
- `docs/03_operacao_mlopps.md`
- `docs/06_ultralytics_treino.md`
- `docs/09_pipeline_treinamento_profissional.md`
- `docs/10_runbook_mlops_treino_gpu.md`

## 3. Fluxo de teste local do pipeline de treino

### 3.1 Preparar ambiente

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install --upgrade pip
python3 -m pip install -r requirements.txt
```

### 3.2 Sanidade rapida

```bash
test -f configs/dataset.yaml && echo "dataset yaml ok"
python3 -m compileall -q src && echo "python ok"
python3 -c "import torch; print('cuda=', torch.cuda.is_available(), 'mps=', getattr(torch.backends, 'mps', None) and torch.backends.mps.is_available())"
```

### 3.3 Treino baseline local GPU

```bash
bash scripts/run_train_pipeline.sh
```

### 3.4 Treino com tracking de experimento (MLflow)

```bash
INSTALL_MLOPS_DEPS=1 TRAIN_USE_MLFLOW=1 bash scripts/run_train_pipeline.sh
```

### 3.5 Reproducao controlada (DVC)

```bash
dvc repro train
```

## 4. Como testar o pipeline de inferencia/contagem

### 4.1 Inferencia em video/rtsp/camera

```bash
bash scripts/run_inference.sh
```

### 4.2 Dashboard web para validacao online

```bash
bash scripts/run_web.sh
```

### 4.3 Dashboard com camera do cliente no browser

```bash
bash scripts/run_web_mobile.sh
```

## 5. Como monitorar

## 5.1 Monitoramento de treino

Monitorar por rodada:

- `runs/people_count/<run_name>/results.csv`
- `outputs/train_summary_*.json`
- pesos `best.pt` e `last.pt`

KPIs minimos para comparacao:

- `metrics/mAP50(B)`
- `metrics/mAP50-95(B)`
- `metrics/precision(B)`
- `metrics/recall(B)`

## 5.2 Monitoramento operacional de contagem

Monitorar em producao assistida:

- total de entrada e saida por janela de tempo
- estabilidade da taxa de contagem por hora
- taxa de divergencia entre contagem automatica e amostra manual
- latencia observada no stream

Evidencias de operacao ficam em:

- `outputs/count_summary_*.csv`

## 5.3 Monitoramento de plataforma

No modo HUB, monitorar:

- status do run
- historico de metricas
- comparacao entre experimentos
- artefatos por versao de modelo

Comando:

```bash
TRAIN_PIPELINE_MODE=hub bash scripts/run_train_pipeline.sh
```

## 6. Como subir de local para plataforma com seguranca

Fluxo recomendado:

1. Rodar baseline local com GPU.
2. Validar KPIs minimos de treino.
3. Validar inferencia/contagem no dashboard.
4. Executar no modo HUB para rastreabilidade central.
5. Promover apenas modelos aprovados por criterio operacional.

## 7. Checklist de release do modelo

- dataset versionado e consistente
- config de treino versionada
- metricas tecnicas acima do baseline
- validacao operacional sem regressao
- artefatos salvos e rastreaveis
- plano de rollback para ultimo `best.pt` estavel
