#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script temporário para validação de conexão e teste de inserção no Supabase.
Tabela testada: usuarios_cadastrados
"""

import os
import sys
import json
import argparse
from datetime import datetime
from pathlib import Path

# Carrega variáveis do arquivo .env
try:
    from dotenv import load_dotenv
    env_path = Path(__file__).resolve().parent / ".env"
    if env_path.exists():
        load_dotenv(dotenv_path=env_path)
    else:
        load_dotenv()
except ImportError:
    # Fallback caso python-dotenv não estivesse presente
    env_file = Path(__file__).resolve().parent / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ[k.strip()] = v.strip().strip('"').strip("'")

try:
    import requests
except ImportError:
    print("[ERRO] A biblioteca 'requests' não está instalada. Execute: pip install requests")
    sys.exit(1)


def mascara_key(key: str) -> str:
    """Oculta a maior parte da chave para exibição segura no console."""
    if not key or len(key) <= 10:
        return "***"
    return f"{key[:6]}...{key[-4:]}"


def obter_rest_url(raw_url: str) -> str:
    """Normaliza a URL base para o endpoint REST v1 do Supabase."""
    url = raw_url.strip().rstrip("/")
    if not url.endswith("/rest/v1"):
        url = f"{url}/rest/v1"
    return url


def testar_supabase(remover_apos_teste: bool = False):
    print("=" * 60)
    print("      TESTE DE CONEXÃO E PERSISTÊNCIA - SUPABASE")
    print("=" * 60)

    # 1. Carregar credenciais
    raw_url = os.getenv("SUPABASE_URL")
    api_key = os.getenv("SUPABASE_KEY")

    if not raw_url or not api_key:
        print("[FALHA] As variáveis SUPABASE_URL ou SUPABASE_KEY não foram encontradas no .env!")
        return False

    base_url = obter_rest_url(raw_url)
    endpoint = f"{base_url}/usuarios_cadastrados"

    print(f"[*] Supabase Endpoint: {base_url}")
    print(f"[*] Chave detectada:   {mascara_key(api_key)}")
    print("-" * 60)

    headers = {
        "apikey": api_key,
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }

    # 2. Testar conectividade (GET)
    print("\n[ETAPA 1/3] Testando conectividade com 'usuarios_cadastrados'...")
    try:
        resp_get = requests.get(f"{endpoint}?limit=1", headers=headers, timeout=10)
    except requests.exceptions.RequestException as e:
        print(f"[ERRO DE CONEXÃO] Falha ao contatar o servidor Supabase: {e}")
        return False

    if resp_get.status_code == 200:
        print(f"[SUCESSO] Conexão estabelecida com sucesso! (Status {resp_get.status_code})")
    elif resp_get.status_code in (401, 403):
        print(f"[FALHA DE AUTENTICAÇÃO] Status {resp_get.status_code}: Verifique a SUPABASE_KEY no .env.")
        print(f"Detalhes: {resp_get.text}")
        return False
    elif resp_get.status_code == 404:
        print(f"[FALHA] Tabela ou endpoint não encontrado (Status 404). Verifique a URL e o nome da tabela.")
        return False
    else:
        print(f"[AVISO] Resposta inesperada: Status {resp_get.status_code} - {resp_get.text}")

    # 3. Inserir registro de teste (POST)
    print("\n[ETAPA 2/3] Inserindo registro de teste na tabela...")
    timestamp_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    nome_teste = f"Teste Automático - {timestamp_str}"
    
    # Embedding simulado de 512 dimensões (requerido pela coluna public.vector(512))
    vetor_512 = [0.0] * 512
    # Define alguns valores para não ser totalmente nulo
    vetor_512[0] = 0.123
    vetor_512[511] = 0.789

    payload = {
        "nome": nome_teste,
        "embedding": vetor_512
    }

    try:
        resp_post = requests.post(endpoint, headers=headers, json=payload, timeout=10)
    except requests.exceptions.RequestException as e:
        print(f"[ERRO] Falha ao enviar requisição de inserção: {e}")
        return False

    if resp_post.status_code in (200, 201):
        dados_inseridos = resp_post.json()
        print(f"[SUCESSO] Registro inserido com êxito! (Status {resp_post.status_code})")
        
        reg = dados_inseridos[0] if isinstance(dados_inseridos, list) and dados_inseridos else dados_inseridos
        reg_id = reg.get("id") if isinstance(reg, dict) else None
        
        print("\n--- Dados do Registro Criado no Supabase ---")
        if isinstance(reg, dict):
            print(f"ID Gerado:   {reg.get('id')}")
            print(f"Nome:        {reg.get('nome')}")
            print(f"Timestamp:   {reg.get('timestamp')}")
            print(f"Soft Delete: {reg.get('soft_delete')}")
            print(f"Dimensões do Embedding: 512 posições aceitas")
        else:
            print(json.dumps(dados_inseridos, indent=2, ensure_ascii=False))
        print("--------------------------------------------")
    else:
        print(f"[FALHA NA INSERÇÃO] Status {resp_post.status_code}: {resp_post.text}")
        return False

    # 4. Validar consulta pelo ID inserido (GET)
    if reg_id:
        print("\n[ETAPA 3/3] Confirmando persistência consultando o registro recém-criado...")
        try:
            resp_check = requests.get(f"{endpoint}?id=eq.{reg_id}", headers=headers, timeout=10)
            if resp_check.status_code == 200 and resp_check.json():
                print(f"[SUCESSO] Registro confirmado no banco de dados!")
            else:
                print(f"[AVISO] Não foi possível re-consultar o ID {reg_id}: {resp_check.text}")
        except Exception as e:
            print(f"[AVISO] Falha ao checar registro: {e}")

    # 5. Limpeza opcional
    if remover_apos_teste and reg_id:
        print(f"\n[*] Limpando registro de teste ID: {reg_id}...")
        try:
            resp_del = requests.delete(f"{endpoint}?id=eq.{reg_id}", headers=headers, timeout=10)
            if resp_del.status_code in (200, 204):
                print("[SUCESSO] Registro de teste removido do banco.")
            else:
                print(f"[AVISO] Não foi possível remover: {resp_del.text}")
        except Exception as e:
            print(f"[AVISO] Erro na exclusão: {e}")
    elif reg_id:
        print(f"\n[INFO] O registro de teste foi MANTIDO na tabela para sua conferência no painel do Supabase.")
        print(f"       Para remover automaticamente após o teste, use: python testar_conexao_supabase.py --limpar")

    print("\n" + "=" * 60)
    print("      CONCLUÍDO: Conexão e credenciais 100% funcionais!")
    print("=" * 60)
    return True


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Teste de conexão e inserção no Supabase.")
    parser.add_argument(
        "--limpar",
        action="store_true",
        help="Remove o registro de teste logo após validar a inserção."
    )
    args = parser.parse_args()

    sucesso = testar_supabase(remover_apos_teste=args.limpar)
    sys.exit(0 if sucesso else 1)
