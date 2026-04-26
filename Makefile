SHELL := /bin/bash
ENV ?= dev
K8S_DIR := infra/k8s/overlays/$(ENV)
BACKEND_IMAGE ?= ghcr.io/amarorn/visioncount-backend:latest
FRONTEND_IMAGE ?= ghcr.io/amarorn/visioncount-frontend:latest

.PHONY: k8s-dev-up k8s-prod-plan k8s-apply k8s-delete k8s-smoke docker-build-backend docker-build-frontend

docker-build-backend:
	docker build -f docker/Dockerfile.backend -t $(BACKEND_IMAGE) .

docker-build-frontend:
	docker build -f docker/Dockerfile.frontend -t $(FRONTEND_IMAGE) .

k8s-dev-up:
	kubectl apply -k infra/k8s/overlays/dev

k8s-prod-plan:
	kubectl diff -k infra/k8s/overlays/prod || true

k8s-apply:
	kubectl apply -k $(K8S_DIR)

k8s-delete:
	kubectl delete -k $(K8S_DIR)

k8s-smoke:
	kubectl -n $(ENV) get pods
	kubectl -n $(ENV) get svc
	kubectl -n $(ENV) get gateway
	kubectl -n $(ENV) get httproute
