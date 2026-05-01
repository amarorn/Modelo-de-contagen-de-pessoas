# Operacao e MLOps

## 1. Fluxo de Ambiente

- `dev`: experimentacao
- `staging`: validacao integrada em video gravado
- `prod`: camera real em porta

## 2. Deploy

- build de container com runtime de inferencia
- deploy no edge device com watchdog
- health check local e heartbeat para nuvem

## 3. Monitoramento

- Sistema:
  - CPU, GPU, memoria, temperatura
- Modelo:
  - FPS, latencia, taxa de deteccao, taxa de `unknown`
- Negocio:
  - entradas/hora, saidas/hora, saldo por turno

## 4. Alertas

- queda abrupta de deteccoes
- aumento de latencia acima do p95 acordado
- drift de distribuicao de features

## 5. Drift e Re-Treino

- gatilhos:
  - degradacao de KPI por 3 dias consecutivos
  - mudanca fisica de camera ou ambiente
- acoes:
  - coletar novo lote
  - re-rotular amostra critica
  - treinar e comparar com modelo atual

## 6. Observabilidade

- logs estruturados por `event_id`, `track_id`, `camera_id`
- tracos de pipeline com correlacao temporal
- dashboard unico para operacao e ciencia de dados

## 7. Runbook de Incidentes

1. Validar status de camera e stream.
2. Verificar health do servico de inferencia.
3. Inspecionar metricas de latencia/FPS.
4. Executar fallback para modelo anterior se necessario.
5. Abrir post-mortem com causa raiz e acoes corretivas.
