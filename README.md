# Modelo de Contagem de Pessoas em Porta com Classificacao de Sexo

Este repositorio define a arquitetura, pipeline de treinamento, operacao e documentacao completa para um sistema de:

- contagem de pessoas que atravessam uma porta em tempo real
- classificacao de sexo (opcional) para analise agregada

## Objetivo

Contar entradas e saidas com alta precisao, baixa latencia e rastreabilidade de dados/modelos.

## Estrutura

- `docs/01_arquitetura.md`: arquitetura tecnica completa e componentes
- `docs/02_pipeline_treinamento.md`: pipeline de dados e treinamento fim a fim
- `docs/03_operacao_mlopps.md`: operacao, deploy, monitoramento e ciclo de melhoria
- `docs/04_privacidade_etica.md`: LGPD, vies e governanca
- `docs/05_plano_validacao.md`: metodos de validacao, metricas e criterios de aceite
- `docs/06_ultralytics_treino.md`: guia de treino local/HUB na Ultralytics
- `docs/07_web_online.md`: dashboard web e publicacao online
- `docs/openapi.yaml`: especificacao OpenAPI 3.0 da API REST do dashboard; com o servidor a correr, UI em `http://localhost:8080/docs` (porta conforme `WEB_PORT`)
- `docs/08_mobile_camera_browser.md`: camera do proprio celular no navegador
- `docs/11_guia_teste_pipeline_local_monitoramento.md`: guia rapido para testar pipeline, monitorar e subir para plataforma
- `docs/diagrams/`: diagramas Mermaid prontos para renderizacao
- `configs/model_config.yaml`: hiperparametros e configuracoes de treino
- `configs/dataset.yaml`: configuracao de dataset YOLO
- `src/train_ultralytics.py`: treino real com API Ultralytics
- `src/infer_ultralytics_count.py`: inferencia + contagem por linha
- `src/web_dashboard.py`: dashboard web em tempo real
- `src/web_mobile_camera.py`: backend para camera do proprio usuario no browser
- `scripts/run_train.sh`: script de treinamento
- `scripts/run_inference.sh`: script de inferencia em edge
- `scripts/run_web.sh`: script para dashboard web
- `scripts/run_web_mobile.sh`: script para dashboard com camera do celular do usuario

## Stack adotado

- Detector principal: YOLOv8m (Ultralytics)
- Rastreamento: ByteTrack (`model.track(..., tracker="bytetrack.yaml")`)
- Regra de contagem: cruzamento de linha virtual na porta (ou ROI poligonal em `/roi`)
- Classificador de sexo (opcional): modelo YOLO `task=classify` com `--sex-model`; apenas totais agregados na entrada, com abstention; ver `docs/04_privacidade_etica.md` e `src/sex_classifier_agg.py`
- MLOps: opcao de uso de Ultralytics HUB via `ULTRALYTICS_HUB_API_KEY`

## Como treinar

```bash
bash scripts/run_train.sh
```

## Como rodar inferencia/contagem

```bash
bash scripts/run_inference.sh
```

## Como rodar no navegador

```bash
bash scripts/run_web.sh
```

Estatistica agregada por sexo (opcional): treine um classificador YOLO (`yolo classify`) com classes nomeadas `female`/`male` (ou `mulher`/`homem`) e defina no `.env` `YOLO_SEX_MODEL=/caminho/para/best.pt` e opcionalmente `YOLO_SEX_ABSTAIN=0.65`.

## Como usar camera do proprio celular (quem acessa)

```bash
bash scripts/run_web_mobile.sh
```

## Proxima etapa recomendada

1. Coletar dados reais no angulo final da camera da porta.
2. Rotular dataset e executar baseline de treinamento.
3. Validar no ambiente real por pelo menos 7 dias.
